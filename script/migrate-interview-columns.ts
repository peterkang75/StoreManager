// One-shot migration for §6.1.13 interview flow.
// Adds the new candidate + employee columns safely (IF NOT EXISTS), using
// the same `pg` driver the app already uses — avoids the psql/Railway
// proxy flakiness.
//
// Run: DATABASE_URL='<public url>' npx tsx script/migrate-interview-columns.ts

import pg from "pg";
const { Pool } = pg;

const STATEMENTS = [
  `ALTER TABLE candidates ADD COLUMN IF NOT EXISTS phone text`,
  `ALTER TABLE candidates ADD COLUMN IF NOT EXISTS birth_year integer`,
  `ALTER TABLE candidates ADD COLUMN IF NOT EXISTS has_experience boolean DEFAULT false NOT NULL`,
  `ALTER TABLE candidates ADD COLUMN IF NOT EXISTS availability_days jsonb`,
  `ALTER TABLE candidates ADD COLUMN IF NOT EXISTS availability_commitment text`,
  `ALTER TABLE candidates ADD COLUMN IF NOT EXISTS visa_expiry_month text`,
  `ALTER TABLE employees ADD COLUMN IF NOT EXISTS candidate_id varchar REFERENCES candidates(id)`,
];

async function runOne(url: string, sql: string, attempt = 1): Promise<void> {
  const pool = new Pool({
    connectionString: url,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 10_000,
    idleTimeoutMillis: 5_000,
    max: 1,
  });
  try {
    await pool.query(sql);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (attempt < 3 && /ECONNRESET|closed the connection|ETIMEDOUT/i.test(msg)) {
      console.log(` ↻ retry ${attempt}`);
      await new Promise((r) => setTimeout(r, 1000 * attempt));
      await pool.end().catch(() => {});
      return runOne(url, sql, attempt + 1);
    }
    throw err;
  } finally {
    await pool.end().catch(() => {});
  }
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL env var is required");
    process.exit(1);
  }

  console.log("Connecting…");
  for (const sql of STATEMENTS) {
    process.stdout.write(`→ ${sql.slice(0, 70)}…  `);
    await runOne(url, sql);
    console.log("✓");
  }

  console.log("\nDone. All 7 columns ensured.");
}

main().catch((err) => {
  console.error("\nMigration failed:", err.message);
  process.exit(1);
});
