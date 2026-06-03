import dotenv from 'dotenv';
import https from 'https';
dotenv.config();

const CSRF_TOKEN = process.env.UPSTREAM_CSRF_TOKEN || '';
const SESSION_COOKIE = process.env.UPSTREAM_SESSION_COOKIE || '';
const DATABASE_ID = parseInt(process.env.UPSTREAM_DATABASE_ID || '28', 10);
const SQL_EDITOR_ID = process.env.UPSTREAM_SQL_EDITOR_ID || '68';
const SCHEMA = process.env.UPSTREAM_SCHEMA || 'public';

async function test() {
  const payload = {
    client_id: "testclient2",
    database_id: DATABASE_ID,
    json: true,
    runAsync: false,
    schema: SCHEMA,
    sql: "SHOW CATALOGS;",
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

  const req = https.request(reqOptions, (res) => {
    let rawData = '';
    res.on('data', (c) => rawData += c);
    res.on('end', () => console.log("Status:", res.statusCode, rawData));
  });
  req.write(JSON.stringify(payload));
  req.end();
}

test().catch(console.error);
