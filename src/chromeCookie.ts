import crypto from 'crypto';
import os from 'os';
import path from 'path';
import fs from 'fs';
import { execFileSync } from 'child_process';

/**
 * Chrome Cookie Auto-Extractor (macOS).
 *
 * Reads the encrypted `session` cookie that Superset (query.urbox.services) stores
 * in the local Google Chrome cookie database, decrypts it using the AES key kept in
 * the macOS Keychain ("Chrome Safe Storage"), and returns the plaintext Flask session
 * cookie value.
 *
 * This removes the need to manually copy `UPSTREAM_SESSION_COOKIE` into `.env`
 * every time the Superset session expires — as long as the user is still logged in
 * via Chrome, the fresh cookie is picked up automatically.
 *
 * Zero external dependencies: uses the `sqlite3` and `security` CLI tools that ship
 * with macOS, plus Node's built-in `crypto`.
 */

// Default target Superset host. Overridable via UPSTREAM_COOKIE_HOST.
const DEFAULT_HOST = 'query.urbox.services';

// Chrome's fixed KDF parameters on macOS for "v10" encrypted cookies.
const KDF_SALT = 'saltysalt';
const KDF_ITERATIONS = 1003;
const KDF_KEYLEN = 16;
const AES_IV = Buffer.alloc(16, ' '); // 16 spaces

// On modern macOS Chrome, the decrypted plaintext is prefixed with a 32-byte
// SHA256 hash of the cookie's domain. Strip it to recover the real value.
const DOMAIN_HASH_PREFIX_LEN = 32;

interface CachedCookie {
  value: string;
  fetchedAt: number;
}

let cache: CachedCookie | null = null;
const CACHE_TTL_MS = 30 * 1000; // Re-read from Chrome at most every 30s

/**
 * Locates the Chrome "Cookies" SQLite database, checking common profile directories.
 */
function findCookieDbPath(): string | null {
  const base = path.join(
    os.homedir(),
    'Library',
    'Application Support',
    'Google',
    'Chrome'
  );

  const candidates = [
    process.env.CHROME_COOKIE_DB, // explicit override
    path.join(base, 'Default', 'Cookies'),
    path.join(base, 'Profile 1', 'Cookies'),
    path.join(base, 'Profile 2', 'Cookies'),
  ].filter((p): p is string => typeof p === 'string' && p.length > 0);

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

/**
 * Retrieves the "Chrome Safe Storage" AES key from the macOS Keychain.
 * May trigger a one-time Keychain permission prompt on first use.
 */
function getChromeSafeStorageKey(): string | null {
  try {
    const out = execFileSync(
      'security',
      ['find-generic-password', '-w', '-s', 'Chrome Safe Storage', '-a', 'Chrome'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }
    );
    return out.trim() || null;
  } catch {
    return null;
  }
}

/**
 * Reads the raw encrypted cookie blob (as a hex string) for the given host + name
 * out of the Chrome cookie database. Copies the DB first because Chrome may hold a
 * lock on the live file.
 */
function readEncryptedCookieHex(host: string, name: string): string | null {
  const dbPath = findCookieDbPath();
  if (!dbPath) {
    console.error('[ChromeCookie] Chrome cookie database not found.');
    return null;
  }

  const tmpCopy = path.join(os.tmpdir(), `sqlab_chrome_cookies_${process.pid}.db`);
  try {
    fs.copyFileSync(dbPath, tmpCopy);
  } catch (err: any) {
    console.error(`[ChromeCookie] Failed to copy cookie DB: ${err.message}`);
    return null;
  }

  try {
    // Match either exact host or a subdomain/leading-dot variant.
    const query =
      `SELECT hex(encrypted_value) FROM cookies ` +
      `WHERE name='${name.replace(/'/g, "''")}' ` +
      `AND host_key LIKE '%${host.replace(/'/g, "''")}%' ` +
      `ORDER BY length(encrypted_value) DESC LIMIT 1;`;

    const out = execFileSync('sqlite3', [tmpCopy, query], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();

    return out || null;
  } catch (err: any) {
    console.error(`[ChromeCookie] Failed to query cookie DB: ${err.message}`);
    return null;
  } finally {
    fs.unlink(tmpCopy, () => {});
  }
}

/**
 * Decrypts a Chrome "v10" AES-128-CBC encrypted cookie value.
 */
function decryptCookie(encryptedHex: string, safeStorageKey: string): string | null {
  try {
    const encrypted = Buffer.from(encryptedHex, 'hex');
    const version = encrypted.slice(0, 3).toString('utf8');

    if (version !== 'v10' && version !== 'v11') {
      console.error(`[ChromeCookie] Unsupported cookie encryption version: "${version}".`);
      return null;
    }

    const payload = encrypted.slice(3);
    const key = crypto.pbkdf2Sync(
      safeStorageKey,
      KDF_SALT,
      KDF_ITERATIONS,
      KDF_KEYLEN,
      'sha1'
    );

    const decipher = crypto.createDecipheriv('aes-128-cbc', key, AES_IV);
    decipher.setAutoPadding(true);
    const decrypted = Buffer.concat([decipher.update(payload), decipher.final()]);

    // Strip the 32-byte SHA256 domain-hash prefix used by modern macOS Chrome.
    let value = decrypted.slice(DOMAIN_HASH_PREFIX_LEN).toString('utf8');

    // Safety net: if the prefix wasn't actually present (older Chrome), fall back
    // to trimming any leading non-printable bytes.
    if (!/^[\x20-\x7E]/.test(value)) {
      value = decrypted.toString('utf8').replace(/^[\x00-\x1F]+/, '');
    }

    return value || null;
  } catch (err: any) {
    console.error(`[ChromeCookie] Failed to decrypt cookie: ${err.message}`);
    return null;
  }
}

/**
 * Returns the current Superset `session` cookie value from Chrome, or null if it
 * cannot be extracted (Chrome not installed, not logged in, non-macOS, etc.).
 *
 * Results are cached briefly to avoid re-reading the DB on every upstream request.
 */
export function getSupersetSessionCookieFromChrome(forceRefresh = false): string | null {
  if (process.platform !== 'darwin') {
    return null; // This extractor is macOS-specific.
  }

  const now = Date.now();
  if (!forceRefresh && cache && now - cache.fetchedAt < CACHE_TTL_MS) {
    return cache.value;
  }

  const host = process.env.UPSTREAM_COOKIE_HOST || DEFAULT_HOST;

  const safeKey = getChromeSafeStorageKey();
  if (!safeKey) {
    console.error(
      '[ChromeCookie] Could not read "Chrome Safe Storage" key from Keychain.'
    );
    return null;
  }

  const encryptedHex = readEncryptedCookieHex(host, 'session');
  if (!encryptedHex) {
    console.error(
      `[ChromeCookie] No "session" cookie found for host "${host}" in Chrome. ` +
        'Make sure you are logged in to Superset in Google Chrome.'
    );
    return null;
  }

  const value = decryptCookie(encryptedHex, safeKey);
  if (!value) {
    return null;
  }

  cache = { value, fetchedAt: now };
  console.log(
    `[ChromeCookie] Loaded fresh Superset session cookie from Chrome (host: ${host}).`
  );
  return value;
}

/**
 * Invalidates the in-memory cookie cache so the next call re-reads from Chrome.
 */
export function clearChromeCookieCache(): void {
  cache = null;
}
