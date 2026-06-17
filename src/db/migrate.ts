import { q } from './client';

// Idempotent, additive schema migrations applied on every startup.
//
// db/init/01_schema.sql only runs on a *fresh* Postgres data dir (it's mounted
// into docker-entrypoint-initdb). Existing deployments never see new columns
// added there, so any additive change must also be expressed here as an
// `IF NOT EXISTS` statement. These are safe to run repeatedly.
const MIGRATIONS: Array<{ name: string; sql: string }> = [
  {
    name: 'tickets.opener_left',
    sql: `ALTER TABLE tickets ADD COLUMN IF NOT EXISTS opener_left BOOLEAN NOT NULL DEFAULT FALSE`,
  },
];

export async function runMigrations(): Promise<void> {
  for (const m of MIGRATIONS) {
    try {
      await q(m.sql);
    } catch (err) {
      // Don't let one migration block startup — log loudly and continue.
      console.error(`[migrate] ${m.name} failed:`, err);
    }
  }
  console.log(`[migrate] Applied ${MIGRATIONS.length} idempotent migration(s)`);
}
