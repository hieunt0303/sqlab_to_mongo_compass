import dotenv from 'dotenv';
import https from 'https';

// Load environment variables
dotenv.config();

/**
 * A zero-dependency HTTP client using Node's native 'https' module.
 * Guarantees compatibility on all Node.js versions (including old versions without fetch).
 */
async function httpRequest(
  url: string,
  options: { method: string; headers: Record<string, string>; body?: string }
): Promise<{ ok: boolean; status: number; statusText: string; json: () => Promise<any>; text: () => Promise<string> }> {
  return new Promise((resolve, reject) => {
    const u = new URL(url);

    // Calculate and set the Content-Length header for the POST body
    if (options.body) {
      options.headers['Content-Length'] = String(Buffer.byteLength(options.body));
    }

    const reqOptions = {
      method: options.method,
      headers: options.headers,
      hostname: u.hostname,
      path: u.pathname + u.search,
      port: u.port || 443,
    };

    const req = https.request(reqOptions, (res) => {
      let rawData = '';
      res.on('data', (chunk) => { rawData += chunk; });
      res.on('end', () => {
        resolve({
          ok: !!res.statusCode && res.statusCode >= 200 && res.statusCode < 300,
          status: res.statusCode || 200,
          statusText: res.statusMessage || 'OK',
          json: async () => JSON.parse(rawData),
          text: async () => rawData,
        });
      });
    });

    req.on('error', (err) => reject(err));
    if (options.body) {
      req.write(options.body);
    }
    req.end();
  });
}

/**
 * Generates a unique 10-character alphanumeric transaction ID (client_id) for Superset idempotency.
 */
function generateClientId(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < 10; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

const CSRF_TOKEN = process.env.UPSTREAM_CSRF_TOKEN || '';
const SESSION_COOKIE = process.env.UPSTREAM_SESSION_COOKIE || '';
const CLIENT_ID = process.env.UPSTREAM_CLIENT_ID || 'sVXsVidw3G';
const DATABASE_ID = parseInt(process.env.UPSTREAM_DATABASE_ID || '28', 10);
const SQL_EDITOR_ID = process.env.UPSTREAM_SQL_EDITOR_ID || '68';
const SCHEMA = process.env.UPSTREAM_SCHEMA || 'public';

/**
 * Checks if the upstream credentials are configured.
 */
function isUpstreamConfigured(): boolean {
  return (
    CSRF_TOKEN !== '' &&
    CSRF_TOKEN !== 'YOUR_CSRF_TOKEN_HERE' &&
    SESSION_COOKIE !== '' &&
    SESSION_COOKIE !== 'YOUR_SESSION_COOKIE_HERE'
  );
}

/**
 * Generates rich mock data for testing and local environment demo.
 */
/**
 * Generates rich mock data for testing and local environment demo.
 */
function getMockData(collectionName: string, phoneFilter: string | null): any[] {
  // Dynamic mock data tailored to the queried collection name
  if (collectionName === 'booking_check_rule_logs') {
    return [
      {
        _id: '647248f2a1b3c4d5e6f7a8b1',
        booking_id: 10842,
        rule_name: 'Standard Quota Rule',
        status: 'PASSED',
        phone: phoneFilter || '0987654321',
        message: 'Client quota is within active thresholds.',
        created_at: '2026-05-26T13:46:00Z',
        notes: 'Demo mock rule log. Connection successful!'
      },
      {
        _id: '647248f2a1b3c4d5e6f7a8b2',
        booking_id: 10843,
        rule_name: 'DragonPass Quantity Rule',
        status: 'PASSED',
        phone: phoneFilter || '0912345678',
        message: 'Force quantity to 1 for Service Type 21 lounge.',
        created_at: '2026-05-26T13:40:00Z',
        notes: 'Demo mock rule log. Fill in credentials in .env to query Urbox services!'
      }
    ];
  }

  const allMockUsers = [
    {
      _id: '647248f2a1b3c4d5e6f7a8b1',
      phone: '0987654321',
      name: 'Nguyen Trung Hieu',
      email: 'hieunt@urbox.vn',
      status: 'active',
      role: 'Senior Engineer',
      created_at: '2026-05-26T13:46:00Z',
      notes: 'Demo mock user. Fill in your credentials in .env to query live Urbox services.'
    },
    {
      _id: '647248f2a1b3c4d5e6f7a8b2',
      phone: '0912345678',
      name: 'John Doe',
      email: 'john.doe@example.com',
      status: 'pending',
      role: 'Product Owner',
      created_at: '2026-05-26T13:40:00Z',
      notes: 'Demo mock user. Connection to Fake MongoDB Server is successful!'
    },
    {
      _id: '647248f2a1b3c4d5e6f7a8b3',
      phone: '0988888888',
      name: 'Jane Smith',
      email: 'jane.smith@example.com',
      status: 'active',
      role: 'QA Lead',
      created_at: '2026-05-26T13:30:00Z',
      notes: 'Demo mock user.'
    }
  ];

  if (!phoneFilter) {
    return allMockUsers;
  }

  // If a phone is specified, look for match in mocks, or auto-generate a realistic mock row
  const matched = allMockUsers.filter(user => user.phone === phoneFilter);
  if (matched.length > 0) {
    return matched;
  }

  return [
    {
      _id: `mock_gen_${phoneFilter}`,
      phone: phoneFilter,
      name: `Mock Dynamic User (${phoneFilter})`,
      email: `user.${phoneFilter}@example.com`,
      status: 'active',
      role: 'Client Guest',
      created_at: new Date().toISOString(),
      notes: 'Dynamic mock user. To fetch real database tables, supply your credentials in the .env file.'
    }
  ];
}

/**
 * Recursively scans and parses any stringified JSON (arrays or objects) within returned documents.
 */
function autoParseJsonStrings(val: any): any {
  if (val === null || val === undefined) return val;
  if (typeof val === 'string') {
    const trimmed = val.trim();
    if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
      try {
        const parsed = JSON.parse(val);
        // Recursively inflate in case there are nested stringified JSONs inside the parsed structure
        return autoParseJsonStrings(parsed);
      } catch (e) {
        return val;
      }
    }
  } else if (Array.isArray(val)) {
    return val.map(item => autoParseJsonStrings(item));
  } else if (typeof val === 'object') {
    const cleaned: any = {};
    for (const key of Object.keys(val)) {
      cleaned[key] = autoParseJsonStrings(val[key]);
    }
    return cleaned;
  }
  return val;
}

/**
 * Translates flat Presto/Trino ROW/ARRAY serialized arrays back to MongoDB nested objects.
 */
function formatRequestField(requestVal: any): any {
  if (!Array.isArray(requestVal) || requestVal.length === 0) {
    return requestVal;
  }

  try {
    const quotaArr = requestVal[0];
    if (!Array.isArray(quotaArr)) {
      return requestVal;
    }

    const formattedQuota = quotaArr.map((quotaItem: any) => {
      if (!Array.isArray(quotaItem) || quotaItem.length === 0) return null;
      
      const payloadArr = Array.isArray(quotaItem[0]) ? quotaItem[0] : quotaItem;
      if (!Array.isArray(payloadArr) || payloadArr.length < 6) return null;

      const resource = payloadArr[0];
      const client = payloadArr[1];
      const quantity = payloadArr[2];
      const limitsVal = payloadArr[3];
      const identifier = payloadArr[4];
      const requestId = payloadArr[5];

      let monthVal = null;
      if (Array.isArray(limitsVal)) {
        monthVal = limitsVal[0];
      } else if (typeof limitsVal === 'object' && limitsVal !== null) {
        monthVal = (limitsVal as any).month || (limitsVal as any)[0];
      } else {
        monthVal = limitsVal;
      }

      return {
        quotaPayload: {
          client: client,
          resource: resource,
          quantity: quantity,
          limits: {
            month: monthVal
          },
          identifier: identifier,
          requestId: requestId
        }
      };
    }).filter(Boolean);

    return {
      quota: formattedQuota
    };
  } catch (err) {
    console.error('[Format] Failed to format request field:', err);
    return requestVal;
  }
}

/**
 * Normalizes lowercase relational database fields back to MongoDB standard camelCase structure.
 */
function normalizeMongoSchema(doc: any): any {
  if (!doc || typeof doc !== 'object') return doc;

  // Remap lowercase SQL columns back to MongoDB camelCase keys
  if ('campaignid' in doc) {
    doc.campaignId = doc.campaignid;
    delete doc.campaignid;
  }
  if ('createdat' in doc) {
    doc.createdAt = doc.createdat;
    delete doc.createdat;
  }
  if ('bookingcode' in doc) {
    doc.bookingCode = doc.bookingcode;
    delete doc.bookingcode;
  }

  // Format request field to match MongoDB nested objects/arrays structure
  if (doc.request) {
    doc.request = formatRequestField(doc.request);
  }

  return doc;
}

/**
 * Robustly parses various forms of tabular responses (from Superset / Urbox execute SQL editor).
 */
function parseTabularResponse(response: any): any[] {
  const docs = rawParseTabularResponse(response);
  return docs.map(doc => normalizeMongoSchema(autoParseJsonStrings(doc)));
}

function rawParseTabularResponse(response: any): any[] {
  if (!response) return [];

  console.log('[Upstream] Parsing response structure...');

  // Case 1: Standard SuperSet/Trino execute response format: { data: { columns: [...], results: [...] } } or { columns: [...], results: [...] }
  const columns = response.columns || response.data?.columns;
  const results = response.results || response.data?.results || response.rows || response.data?.rows;

  if (Array.isArray(columns) && Array.isArray(results)) {
    console.log(`[Upstream] Tabular format parsed. Columns: [${columns.join(', ')}]. Total Rows: ${results.length}`);
    return results.map((row: any[], rowIndex: number) => {
      const doc: any = {};
      columns.forEach((col: string, colIndex: number) => {
        doc[col] = row[colIndex];
      });
      // MongoDB clients expect an _id field in documents
      if (!doc._id) {
        doc._id = doc.id || doc.phone || `row_${rowIndex}_${Date.now()}`;
      }
      return doc;
    });
  }

  // Case 2: Response contains an array of objects
  if (Array.isArray(response.data)) {
    console.log(`[Upstream] List format parsed. Total Items: ${response.data.length}`);
    return response.data.map((item: any, index: number) => {
      if (!item._id) {
        item._id = item.id || item.phone || `item_${index}_${Date.now()}`;
      }
      return item;
    });
  }

  if (Array.isArray(response)) {
    console.log(`[Upstream] Flat list format parsed. Total Items: ${response.length}`);
    return response.map((item: any, index: number) => {
      if (!item._id) {
        item._id = item.id || item.phone || `item_${index}_${Date.now()}`;
      }
      return item;
    });
  }

  // Case 3: Nested arrays of objects check
  for (const key of Object.keys(response)) {
    if (Array.isArray(response[key]) && response[key].length > 0 && typeof response[key][0] === 'object') {
      console.log(`[Upstream] Found nested array in key: "${key}". Total items: ${response[key].length}`);
      return response[key].map((item: any, index: number) => {
        if (!item._id) {
          item._id = item.id || item.phone || `nested_${index}_${Date.now()}`;
        }
        return item;
      });
    }
  }

  console.warn('[Upstream] Unrecognized data structure from upstream. Returning raw wrapped object.', JSON.stringify(response).substring(0, 300));
  
  // As a fallback wrapper
  return [{
    _id: 'unknown_format_id',
    rawResponse: response
  }];
}

/**
 * Translates a MongoDB/BSON filter object into a SQL WHERE clause.
 * Supports standard equality, nested operators ($eq, $ne, $in, $nin, $gt, $gte, $lt, $lte), logical $and conjunctions,
 * and maps keys back to correct SQL columns.
 */
function translateMongoFilterToSql(filter: any): string {
  if (!filter || typeof filter !== 'object' || Object.keys(filter).length === 0) {
    return '';
  }

  // Translates MongoDB dot-notation (0-based) to Trino/Presto ROW/ARRAY paths (1-based index)
  const translateMongoKeyToSql = (key: string): string => {
    const parts = key.split('.');
    const sqlParts: string[] = [];

    // Map of camelCase MongoDB fields to lowercase SQL columns/fields
    const fieldMapping: Record<string, string> = {
      campaignId: 'campaignid',
      createdAt: 'createdat',
      bookingCode: 'bookingcode',
      quotaPayload: 'quotapayload',
    };

    const normalizePart = (part: string): string => {
      if (fieldMapping[part]) return fieldMapping[part];
      return part.toLowerCase();
    };

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      
      // Check if the next part is a number (representing array index)
      if (i + 1 < parts.length && /^\d+$/.test(parts[i + 1])) {
        const index = parseInt(parts[i + 1], 10) + 1; // 0-based to 1-based
        sqlParts.push(`${normalizePart(part)}[${index}]`);
        i++; // Skip the index part
      } else {
        sqlParts.push(normalizePart(part));
      }
    }

    return sqlParts.join('.');
  };

  const formatValue = (val: any): string => {
    if (val === null) return 'NULL';
    if (typeof val === 'string') {
      return `'${val.replace(/'/g, "''")}'`;
    }
    if (typeof val === 'number' || typeof val === 'boolean') {
      return String(val);
    }
    if (val instanceof Date) {
      return `'${val.toISOString()}'`;
    }
    return `'${JSON.stringify(val).replace(/'/g, "''")}'`;
  };

  const clauses: string[] = [];

  for (const key of Object.keys(filter)) {
    if (key.startsWith('$')) {
      if (key === '$and' && Array.isArray(filter.$and)) {
        const subClauses = filter.$and
          .map((sub: any) => translateMongoFilterToSql(sub))
          .filter((clause: string) => clause.length > 0);
        if (subClauses.length > 0) {
          clauses.push(`(${subClauses.join(' AND ')})`);
        }
      }
      continue;
    }

    const val = filter[key];
    const sqlKey = translateMongoKeyToSql(key);

    // Handle nested operators, e.g. `{ phone: { $eq: "..." } }`
    if (val && typeof val === 'object' && !Array.isArray(val) && !(val instanceof Date)) {
      const ops = Object.keys(val);
      for (const op of ops) {
        if (op === '$eq') {
          clauses.push(`${sqlKey} = ${formatValue(val.$eq)}`);
        } else if (op === '$ne') {
          clauses.push(`${sqlKey} != ${formatValue(val.$ne)}`);
        } else if (op === '$in' && Array.isArray(val.$in)) {
          const inVals = val.$in.map((v: any) => formatValue(v)).join(', ');
          clauses.push(`${sqlKey} IN (${inVals})`);
        } else if (op === '$nin' && Array.isArray(val.$nin)) {
          const ninVals = val.$nin.map((v: any) => formatValue(v)).join(', ');
          clauses.push(`${sqlKey} NOT IN (${ninVals})`);
        } else if (op === '$gt') {
          clauses.push(`${sqlKey} > ${formatValue(val.$gt)}`);
        } else if (op === '$gte') {
          clauses.push(`${sqlKey} >= ${formatValue(val.$gte)}`);
        } else if (op === '$lt') {
          clauses.push(`${sqlKey} < ${formatValue(val.$lt)}`);
        } else if (op === '$lte') {
          clauses.push(`${sqlKey} <= ${formatValue(val.$lte)}`);
        }
      }
    } else {
      // Simple equality
      clauses.push(`${sqlKey} = ${formatValue(val)}`);
    }
  }

  return clauses.join(' AND ');
}

/**
 * Triggers the upstream API or mock data based on connection status.
 */
export async function fetchDataFromUpstream(collectionName: string, filter: any): Promise<any[]> {
  const phoneFilter = filter?.phone || null;

  if (!isUpstreamConfigured()) {
    console.log(
      `[Upstream] Upstream SQL editor is not configured. Serving local dynamic mock data for collection: "${collectionName}", filter: ${JSON.stringify(filter)}.`
    );
    return getMockData(collectionName, phoneFilter);
  }

  // Dynamically compile MongoDB BSON filter to standard SQL WHERE clause
  const whereClause = translateMongoFilterToSql(filter);
  const sql = whereClause
    ? `SELECT * from ${collectionName} WHERE ${whereClause} LIMIT 100;`
    : `SELECT * from ${collectionName} LIMIT 100;`;

  const payload = {
    client_id: generateClientId(),
    database_id: DATABASE_ID,
    json: true,
    runAsync: false,
    schema: SCHEMA,
    sql: sql,
    sql_editor_id: SQL_EDITOR_ID,
    tab: "Untitled Query 8",
    tmp_table_name: "",
    select_as_cta: false,
    ctas_method: "TABLE",
    queryLimit: 10000,
    expand_data: true,
  };

  console.log(`[Upstream] Dispatching upstream query SQL: "${sql}"`);

  try {
    const url = 'https://query.urbox.services/api/v1/sqllab/execute/';
    const response = await httpRequest(url, {
      method: 'POST',
      headers: {
        'sec-ch-ua': '"Chromium";v="146", "Not-A.Brand";v="24", "Google Chrome";v="146"',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"macOS"',
        'X-CSRFToken': CSRF_TOKEN,
        'Cookie': SESSION_COOKIE.includes('=') ? SESSION_COOKIE : `session=${SESSION_COOKIE}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Referer': 'https://query.urbox.services/sqllab/',
        'Origin': 'https://query.urbox.services',
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36'
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[Upstream] API Request Failed with status ${response.status}: ${errorText}`);
      throw new Error(`Upstream API failed: ${response.statusText}`);
    }

    const data = await response.json();
    console.log('[Upstream] Success! Received response from Urbox SQL Service.');
    return parseTabularResponse(data);
  } catch (error: any) {
    console.error(`[Upstream] Error querying SQL Service: ${error.message}. Falling back to mock data.`);
    return getMockData(collectionName, phoneFilter);
  }
}
