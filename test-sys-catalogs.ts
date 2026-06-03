import dotenv from 'dotenv';
import https from 'https';
dotenv.config();

const CSRF_TOKEN = process.env.UPSTREAM_CSRF_TOKEN || '';
const SESSION_COOKIE = process.env.UPSTREAM_SESSION_COOKIE || '';
const DATABASE_ID = parseInt(process.env.UPSTREAM_DATABASE_ID || '28', 10);
const SQL_EDITOR_ID = process.env.UPSTREAM_SQL_EDITOR_ID || '68';
const SCHEMA = process.env.UPSTREAM_SCHEMA || 'public';

function generateClientId(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < 10; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

async function testQuery(sql: string) {
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

  const reqOptions = {
    method: 'POST',
    hostname: 'query.urbox.services',
    path: '/api/v1/sqllab/execute/',
    headers: {
        'X-CSRFToken': CSRF_TOKEN,
        'Cookie': SESSION_COOKIE.includes('=') ? SESSION_COOKIE : `session=${SESSION_COOKIE}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
    }
  };

  return new Promise((resolve) => {
    const req = https.request(reqOptions, (res) => {
        let rawData = '';
        res.on('data', (c) => rawData += c);
        res.on('end', () => resolve({ status: res.statusCode, data: rawData, sql }));
    });
    req.write(JSON.stringify(payload));
    req.end();
  });
}

async function run() {
    const queries = [
        `SELECT catalog_name FROM system.metadata.catalogs LIMIT 10;`,
        `SELECT current_catalog;`
    ];

    for (const sql of queries) {
        console.log("Trying:", sql);
        const res: any = await testQuery(sql);
        console.log("Status:", res.status);
        console.log("Response:", res.data);
        console.log("---");
    }
}

run().catch(console.error);
