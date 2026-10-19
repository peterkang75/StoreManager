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

  // §7.5 Wave 1: supplier GST default + cash_expenses table
  `ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS default_gst_rate integer NOT NULL DEFAULT 0`,
  // Global "Other / Unknown" sentinel supplier — D14 fallback target so cash_expenses.supplier_id can stay NOT NULL.
  // Owners reassign these rows to a real supplier (or register a new one) during weekly review.
  `INSERT INTO suppliers (name, default_gst_rate, active, is_auto_pay)
   SELECT 'Other / Unknown', 0, true, false
   WHERE NOT EXISTS (SELECT 1 FROM suppliers WHERE name = 'Other / Unknown')`,
  `CREATE TABLE IF NOT EXISTS cash_expenses (
     id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
     store_id varchar NOT NULL REFERENCES stores(id),
     supplier_id varchar NOT NULL REFERENCES suppliers(id),
     amount real NOT NULL DEFAULT 0,
     gst_amount real NOT NULL DEFAULT 0,
     gst_rate_snapshot integer NOT NULL DEFAULT 0,
     expense_date text NOT NULL,
     memo text,
     entered_by varchar REFERENCES employees(id),
     review_status text NOT NULL DEFAULT 'PENDING',
     created_at timestamp NOT NULL DEFAULT now(),
     updated_at timestamp NOT NULL DEFAULT now()
   )`,
  `CREATE INDEX IF NOT EXISTS idx_cash_expenses_store_date ON cash_expenses(store_id, expense_date DESC)`,

  // §7 Wave 1 Day 6: gate the Daily Close cash-expense picker by an admin-
  // controlled per-supplier flag. New column defaults to false so existing
  // bank-paid suppliers stay hidden from the mobile picker; the sentinel is
  // forced to true so the Other/Unknown fallback always reaches employees.
  `ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS cash_expense_eligible boolean NOT NULL DEFAULT false`,
  `UPDATE suppliers SET cash_expense_eligible = true WHERE name = 'Other / Unknown' AND cash_expense_eligible = false`,

  // Body-text fragments that identify a store on inbound invoices (utility
  // account numbers, supply addresses, doing-business-as names, etc.). Used
  // by the AP webhook to auto-assign storeId when a match is found in the
  // email body or parsed PDF text. Nullable text array, no default.
  `ALTER TABLE stores ADD COLUMN IF NOT EXISTS body_aliases text[]`,

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

  // §6.3.12 Post-Payroll Back-Pay Workflow — tracks which shift_timesheets have been
  // applied as back-pay to which payroll. UNIQUE(shift_timesheet_id) blocks double-pay.
  `CREATE TABLE IF NOT EXISTS payroll_back_pay_items (
     id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
     shift_timesheet_id varchar NOT NULL UNIQUE REFERENCES shift_timesheets(id),
     applied_to_payroll_id varchar NOT NULL REFERENCES payrolls(id),
     original_period_start text NOT NULL,
     original_period_end text NOT NULL,
     hours real NOT NULL DEFAULT 0,
     rate real NOT NULL DEFAULT 0,
     amount real NOT NULL DEFAULT 0,
     reason text,
     created_at timestamp NOT NULL DEFAULT now()
   )`,
  `CREATE INDEX IF NOT EXISTS idx_back_pay_items_payroll ON payroll_back_pay_items (applied_to_payroll_id)`,
  // §6.3.12 paid_amount: actual disbursed $ (0 for fixed-salary). One-time backfill
  // inside the guard so it runs ONLY when the column is first added — re-running on
  // every boot would wrongly overwrite future fixed-salary rows (paid_amount=0).
  `DO $$
   BEGIN
     IF NOT EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_name = 'payroll_back_pay_items' AND column_name = 'paid_amount'
     ) THEN
       ALTER TABLE payroll_back_pay_items ADD COLUMN paid_amount real NOT NULL DEFAULT 0;
       UPDATE payroll_back_pay_items SET paid_amount = amount;
     END IF;
   END $$`,

  // §6.3.13 Singleton settings: required-field list for the employee detail form.
  `CREATE TABLE IF NOT EXISTS employee_field_requirements (
     id integer PRIMARY KEY,
     required_fields jsonb NOT NULL DEFAULT '[]'::jsonb,
     updated_at timestamp NOT NULL DEFAULT now()
   )`,
  `INSERT INTO employee_field_requirements (id, required_fields) VALUES (1, '[]'::jsonb)
   ON CONFLICT (id) DO NOTHING`,

  // §6.3.14 Bank account name — Australian payroll requires Account Name in
  // addition to BSB + Account Number.
  `ALTER TABLE employees ADD COLUMN IF NOT EXISTS account_name text`,

  // Timesheet-approval deadline: Director override (presence of row = store+cycle
  // temporarily re-opened for manager approvals after the auto-close).
  `CREATE TABLE IF NOT EXISTS timesheet_approval_overrides (
     id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
     store_id varchar NOT NULL REFERENCES stores(id),
     cycle_start text NOT NULL,
     unlocked_by varchar,
     unlocked_at timestamp NOT NULL DEFAULT now()
   )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS tao_store_cycle_uniq ON timesheet_approval_overrides (store_id, cycle_start)`,

  // Season-based roster hour caps (per store, per season).
  `CREATE TABLE IF NOT EXISTS store_hour_caps (
     id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
     store_id varchar NOT NULL REFERENCES stores(id),
     season text NOT NULL,
     weekly_total_hours real NOT NULL DEFAULT 38,
     saturday_hours real NOT NULL DEFAULT 0,
     sunday_hours real NOT NULL DEFAULT 0,
     public_holiday_hours real NOT NULL DEFAULT 0,
     updated_at timestamp NOT NULL DEFAULT now()
   )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS shc_store_season_uniq ON store_hour_caps (store_id, season)`,
  // Seed TERM/HOLIDAY rows from the advisory recommended-hours table (idempotent:
  // skips stores that already have a cap row for that season).
  `INSERT INTO store_hour_caps (store_id, season, weekly_total_hours)
     SELECT store_id, 'TERM', term_weekly_hours FROM store_recommended_hours
   ON CONFLICT (store_id, season) DO NOTHING`,
  `INSERT INTO store_hour_caps (store_id, season, weekly_total_hours)
     SELECT store_id, 'HOLIDAY', holiday_weekly_hours FROM store_recommended_hours
   ON CONFLICT (store_id, season) DO NOTHING`,

  // PLAN 6.2.2 1-3: statements kept apart from invoices. One row per distinct PDF
  // (pdf_hash UNIQUE); lines only when the arithmetic reconciled to the printed balance.
  `CREATE TABLE IF NOT EXISTS supplier_statements (
     id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
     supplier_id varchar REFERENCES suppliers(id),
     pdf_hash text NOT NULL UNIQUE,
     pdf_base64 text NOT NULL,
     statement_date text,
     closing_balance real,
     family text,
     parse_status text NOT NULL,
     source text,
     received_at timestamp,
     created_at timestamp NOT NULL DEFAULT now()
   )`,
  `CREATE TABLE IF NOT EXISTS supplier_statement_lines (
     id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
     statement_id varchar NOT NULL REFERENCES supplier_statements(id) ON DELETE CASCADE,
     line_type text NOT NULL,
     invoice_number text,
     line_date text,
     due_date text,
     amount real NOT NULL DEFAULT 0,
     balance real
   )`,
  `CREATE INDEX IF NOT EXISTS idx_statement_lines_statement ON supplier_statement_lines (statement_id)`,

  // PLAN 1-5: one row per invoice the line-item extractor has looked at, kept
  // apart from supplier_invoices so a run never bumps the invoice's updated_at.
  `CREATE TABLE IF NOT EXISTS invoice_line_item_runs (
     invoice_id varchar PRIMARY KEY REFERENCES supplier_invoices(id) ON DELETE CASCADE,
     pdf_md5 text NOT NULL,
     status text NOT NULL,
     family text,
     line_count integer NOT NULL DEFAULT 0,
     parser_version integer NOT NULL,
     created_at timestamp NOT NULL DEFAULT now()
   )`,
  // why a run failed (the line it stopped on), readable with a plain DB query
  `ALTER TABLE invoice_line_item_runs ADD COLUMN IF NOT EXISTS detail text`,

  // Product catalogue (stage A): one card per supplier product, plus its price
  // history. Filled from invoice line items; the owner can add, rename, hide.
  `CREATE TABLE IF NOT EXISTS supplier_products (
     id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
     supplier_id varchar NOT NULL REFERENCES suppliers(id),
     product_key text NOT NULL,
     name text NOT NULL,
     name_edited boolean NOT NULL DEFAULT false,
     raw_description text,
     sku text,
     brand text,
     unit text,
     kind text NOT NULL DEFAULT 'goods',
     hidden boolean NOT NULL DEFAULT false,
     source text NOT NULL DEFAULT 'invoice',
     created_at timestamp NOT NULL DEFAULT now(),
     updated_at timestamp NOT NULL DEFAULT now()
   )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS supplier_products_key_uniq ON supplier_products (supplier_id, product_key)`,
  `CREATE TABLE IF NOT EXISTS product_prices (
     id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
     product_id varchar NOT NULL REFERENCES supplier_products(id) ON DELETE CASCADE,
     price_date text NOT NULL,
     unit_price real,
     qty real,
     unit text,
     line_total real,
     invoice_id varchar REFERENCES supplier_invoices(id) ON DELETE SET NULL,
     store_id varchar REFERENCES stores(id),
     source text NOT NULL DEFAULT 'invoice',
     note text,
     created_at timestamp NOT NULL DEFAULT now()
   )`,
  `CREATE INDEX IF NOT EXISTS idx_product_prices_product ON product_prices (product_id, price_date)`,
  `CREATE INDEX IF NOT EXISTS idx_product_prices_invoice ON product_prices (invoice_id)`,

  // Product catalogue stage B: item groups (same item across brands/suppliers) and
  // the owner's pack size override. Auto pack sizes are computed, never stored.
  `CREATE TABLE IF NOT EXISTS item_groups (
     id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
     name text NOT NULL UNIQUE,
     created_at timestamp NOT NULL DEFAULT now()
   )`,
  `ALTER TABLE supplier_products ADD COLUMN IF NOT EXISTS group_id varchar REFERENCES item_groups(id) ON DELETE SET NULL`,
  `ALTER TABLE supplier_products ADD COLUMN IF NOT EXISTS pack_qty real`,
  `ALTER TABLE supplier_products ADD COLUMN IF NOT EXISTS pack_unit text`,
  // suggested-group words the owner dismissed ("WHITE", "PAPER")
  `CREATE TABLE IF NOT EXISTS hidden_group_suggestions (
     word text PRIMARY KEY,
     created_at timestamp NOT NULL DEFAULT now()
   )`,
  // Ordering C-1/2: weekly usage per store x product (term / school holidays), in
  // the product's invoice unit, and how many weeks one order covers per supplier.
  `CREATE TABLE IF NOT EXISTS ordering_usage (
     store_id varchar NOT NULL REFERENCES stores(id),
     product_id varchar NOT NULL REFERENCES supplier_products(id) ON DELETE CASCADE,
     term_weekly real,
     holiday_weekly real,
     updated_at timestamp NOT NULL DEFAULT now(),
     PRIMARY KEY (store_id, product_id)
   )`,
  `CREATE TABLE IF NOT EXISTS ordering_supplier_settings (
     store_id varchar NOT NULL REFERENCES stores(id),
     supplier_id varchar NOT NULL REFERENCES suppliers(id),
     cover_weeks real NOT NULL DEFAULT 1,
     PRIMARY KEY (store_id, supplier_id)
   )`,
  // Ordering C-3: where a supplier takes orders (kept apart from the invoice sender
  // addresses), and every order sent, with its lines and the stock counted then.
  `ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS order_email text`,
  `CREATE TABLE IF NOT EXISTS purchase_orders (
     id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
     store_id varchar NOT NULL REFERENCES stores(id),
     supplier_id varchar NOT NULL REFERENCES suppliers(id),
     status text NOT NULL,
     channel text NOT NULL,
     to_email text,
     subject text NOT NULL,
     body text NOT NULL,
     note text,
     error text,
     sent_by varchar,
     sent_at timestamp,
     created_at timestamp NOT NULL DEFAULT now()
   )`,
  `CREATE TABLE IF NOT EXISTS purchase_order_lines (
     id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
     order_id varchar NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
     product_id varchar REFERENCES supplier_products(id) ON DELETE SET NULL,
     name text NOT NULL,
     sku text,
     unit text,
     qty real NOT NULL,
     stock real
   )`,
  // Ordering from the staff portal: per-employee switches (all off until the owner turns them on) and the latest stock count
  `ALTER TABLE employees ADD COLUMN IF NOT EXISTS can_order boolean NOT NULL DEFAULT false`,
  `ALTER TABLE employees ADD COLUMN IF NOT EXISTS can_set_order_usage boolean NOT NULL DEFAULT false`,
  `CREATE TABLE IF NOT EXISTS ordering_stock (
     store_id varchar NOT NULL REFERENCES stores(id),
     product_id varchar NOT NULL REFERENCES supplier_products(id) ON DELETE CASCADE,
     qty real NOT NULL,
     counted_by varchar,
     counted_at timestamp NOT NULL DEFAULT now(),
     PRIMARY KEY (store_id, product_id)
   )`,
  // managers place the orders: give the new screen a row in the Access Control matrix
  `INSERT INTO admin_permissions (role, route, label, allowed) VALUES
     ('ADMIN', '/admin/ordering', 'Ordering', true),
     ('MANAGER', '/admin/ordering', 'Ordering', true),
     ('STAFF', '/admin/ordering', 'Ordering', false)
   ON CONFLICT (role, route) DO NOTHING`,
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
