// Idempotent, fire-and-forget schema additions run at server startup.
// Uses the same `pool` the rest of the app uses, so it bypasses the flaky
// public Railway proxy (Railway's internal DNS works fine for the app).
//
// Every statement is `IF NOT EXISTS`, so running this on every boot is safe
// — the first boot after a deploy applies the change, subsequent boots
// no-op. Remove individual statements here once they're known-applied in
// every environment you care about.

import { pool } from "./db";

const STATEMENTS: string[] = [
  // §6.1.13 Interview → Hire → Onboarding handoff
  `ALTER TABLE candidates ADD COLUMN IF NOT EXISTS phone text`,
  `ALTER TABLE candidates ADD COLUMN IF NOT EXISTS birth_year integer`,
  `ALTER TABLE candidates ADD COLUMN IF NOT EXISTS has_experience boolean DEFAULT false NOT NULL`,
  `ALTER TABLE candidates ADD COLUMN IF NOT EXISTS availability_days jsonb`,
  `ALTER TABLE candidates ADD COLUMN IF NOT EXISTS availability_commitment text`,
  `ALTER TABLE candidates ADD COLUMN IF NOT EXISTS visa_expiry_month text`,
  `ALTER TABLE employees ADD COLUMN IF NOT EXISTS candidate_id varchar REFERENCES candidates(id)`,

  // Per-day per-store sales ledger (POSnet imports + future integrations)
  `CREATE TABLE IF NOT EXISTS daily_sales (
     id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
     store_id varchar NOT NULL REFERENCES stores(id),
     date text NOT NULL,
     cash real NOT NULL DEFAULT 0,
     credit real NOT NULL DEFAULT 0,
     eftpos real NOT NULL DEFAULT 0,
     others real NOT NULL DEFAULT 0,
     total real NOT NULL DEFAULT 0,
     source text NOT NULL DEFAULT 'manual',
     imported_at timestamp NOT NULL DEFAULT now()
   )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS daily_sales_store_date_uniq ON daily_sales (store_id, date)`,

  // Portal Bearer-token sessions — auth gate for /api/portal/* routes
  `CREATE TABLE IF NOT EXISTS portal_sessions (
     token text PRIMARY KEY,
     employee_id varchar NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
     created_at timestamp NOT NULL DEFAULT now(),
     expires_at timestamp NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS portal_sessions_employee_idx ON portal_sessions (employee_id)`,
];

export async function runBootstrapMigrations(): Promise<void> {
  for (const sql of STATEMENTS) {
    try {
      await pool.query(sql);
    } catch (err) {
      // Log and continue — we never want a migration blip to block startup.
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[bootstrap-migrations] failed: ${sql.slice(0, 80)} — ${msg}`);
    }
  }
  console.log("[bootstrap-migrations] done");
}
