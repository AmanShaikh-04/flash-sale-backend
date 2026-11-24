import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Pool } from 'pg';

async function main() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL ?? 'postgres://flash:flash@localhost:5432/flashsale',
  });
  const sql = readFileSync(join(__dirname, '..', 'db', 'schema.sql'), 'utf8');
  await pool.query(sql);
  console.log('schema applied');
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});