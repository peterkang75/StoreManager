// Idempotent, fire-and-forget schema additions run at server startup.
// Uses the same `pool` the rest of the app uses, so it bypasses the flaky
// public Railway proxy (Railway's internal DNS works fine for the app).
//
// Every statement is `IF NOT EXISTS`, so running this on every boot is safe
// — the first boot after a deploy applies the change, subsequent boots
// no-op. Remove individual statements here once they're known-applied in
// every environment you care about.

import { pool } from "./db";
import bcrypt from "bcryptjs";

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

  // Phase B: admin/manager/staff login support
  `ALTER TABLE employees ADD COLUMN IF NOT EXISTS password_hash text`,
  `ALTER TABLE employees ADD COLUMN IF NOT EXISTS last_login_at timestamp`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_employees_email_lower ON employees (LOWER(email)) WHERE email IS NOT NULL`,

  // Phase B: distinguish PIN vs PASSWORD sessions in same table
  `ALTER TABLE portal_sessions ADD COLUMN IF NOT EXISTS login_type text`,
  `UPDATE portal_sessions SET login_type = 'PIN' WHERE login_type IS NULL`,
  `DO $$ BEGIN
     IF EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_name = 'portal_sessions' AND column_name = 'login_type' AND is_nullable = 'YES'
     ) THEN
       ALTER TABLE portal_sessions ALTER COLUMN login_type SET NOT NULL;
       ALTER TABLE portal_sessions ALTER COLUMN login_type SET DEFAULT 'PIN';
     END IF;
   END $$`,

  // Backfill daily_sales from any existing daily_closings rows so the unified
  // ledger contains both POSnet historical imports and previously-submitted
  // close forms. Idempotent via the (store_id, date) unique index — historical
  // POSnet rows (source='posnet') are preserved by the WHERE-not-exists guard.
  `INSERT INTO daily_sales (id, store_id, date, cash, credit, eftpos, others, total, source, imported_at)
   SELECT
     gen_random_uuid(),
     dc.store_id,
     dc.date,
     COALESCE(dc.cash_sales, 0)        AS cash,
     COALESCE(dc.credit_amount, 0)     AS credit,
     GREATEST(0, COALESCE(dc.sales_total, 0) - COALESCE(dc.cash_sales, 0) - COALESCE(dc.credit_amount, 0)) AS eftpos,
     COALESCE(dc.ubereats_amount, 0) + COALESCE(dc.doordash_amount, 0) AS others,
     COALESCE(dc.sales_total, 0) + COALESCE(dc.ubereats_amount, 0) + COALESCE(dc.doordash_amount, 0) AS total,
     'daily-close' AS source,
     COALESCE(dc.created_at, now()) AS imported_at
   FROM daily_closings dc
   WHERE NOT EXISTS (
     SELECT 1 FROM daily_sales ds
     WHERE ds.store_id = dc.store_id AND ds.date = dc.date
   )`,
];

// Phase B: seed the OWNER's password from environment variables on first deploy.
// Env vars OWNER_EMAIL + OWNER_INITIAL_PASS are one-time setup; remove after first
// successful login. If OWNER_EMAIL doesn't match an existing employee, throw to halt
// boot — better than letting Auto-mode discover this at the login checkpoint.
async function seedOwnerPassword(): Promise<void> {
  const ownerEmail = process.env.OWNER_EMAIL?.trim().toLowerCase();
  const ownerPass = process.env.OWNER_INITIAL_PASS;

  if (!ownerEmail && !ownerPass) return; // both unset — nothing to do (normal steady-state)

  if (ownerEmail && !ownerPass) {
    console.warn(`[auth-seed] OWNER_EMAIL set but OWNER_INITIAL_PASS missing — owner not seeded`);
    return;
  }
  if (!ownerEmail && ownerPass) {
    console.warn(`[auth-seed] OWNER_INITIAL_PASS set but OWNER_EMAIL missing — owner not seeded`);
    return;
  }

  // Both set — try to seed
  const candidate = await pool.query(
    `SELECT id FROM employees WHERE LOWER(email) = $1 AND password_hash IS NULL LIMIT 1`,
    [ownerEmail],
  );

  if (candidate.rows.length > 0) {
    const hash = await bcrypt.hash(ownerPass!, 10);
    await pool.query(
      `UPDATE employees SET password_hash = $1, role = 'ADMIN' WHERE id = $2`,
      [hash, candidate.rows[0].id],
    );
    console.log(`[auth-seed] OWNER 비번 시드 완료: ${ownerEmail} (env에서 OWNER_INITIAL_PASS 제거 권장)`);
    return;
  }

  // No matching employee with NULL hash — figure out why
  const exists = await pool.query(
    `SELECT id, password_hash IS NOT NULL AS has_pass FROM employees WHERE LOWER(email) = $1 LIMIT 1`,
    [ownerEmail],
  );

  if (exists.rows.length === 0) {
    const msg = `OWNER_EMAIL='${ownerEmail}' not found in employees table. Add employee with that email or fix env var.`;
    console.error(`[auth-seed] ❌ ${msg}`);
    throw new Error(`auth-seed: ${msg}`);
  }

  // Employee exists but already has password — leave alone
  console.log(`[auth-seed] OWNER 비번 이미 설정됨 (${ownerEmail}) — skip`);
}

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
  await seedOwnerPassword();
  console.log("[bootstrap-migrations] done");
}
