import { Pool } from 'pg';

// Require TLS when talking to a REMOTE database (set PGSSL=require). Inside the
// docker-compose network the DB is plaintext on a private network, which is fine.
const ssl = process.env.PGSSL === 'require' ? { rejectUnauthorized: true } : undefined;

// Connect via DATABASE_URL (used by docker-compose) or discrete PG* vars (local dev).
export const pool = process.env.DATABASE_URL
  ? new Pool({ connectionString: process.env.DATABASE_URL, ssl })
  : new Pool({
      host: process.env.PGHOST ?? 'localhost',
      port: Number(process.env.PGPORT ?? 5432),
      user: process.env.PGUSER,
      password: process.env.PGPASSWORD,
      database: process.env.PGDATABASE,
      ssl,
    });

pool.on('error', (err) => console.error('[db] idle client error:', err));

// Run a query, returning all rows.
export async function q<T = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<T[]> {
  const res = await pool.query(text, params);
  return res.rows as T[];
}

// Run a query, returning the first row or null.
export async function one<T = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<T | null> {
  const res = await pool.query(text, params);
  return (res.rows[0] as T) ?? null;
}
