// Import historical POSnet daily sales export (xlsx) into daily_sales.
//
// Idempotent — re-running with the same file is a no-op (UNIQUE
// store_id+date with ON CONFLICT DO NOTHING).
//
// Usage:
//   DATABASE_URL='<railway public url>' npx tsx script/import-posnet-sales.ts \
//     --file=/path/to/Sales.xlsx --store=Sushi --until=2026-04-29
//
// --until is INCLUSIVE; rows with SALES_DATE > until are skipped so ongoing
// daily entries can flow via dailyClosings without overlap.

import pg from "pg";
import XLSX from "xlsx";

const { Pool } = pg;

type Args = { file: string; store: string; until: string };

function parseArgs(): Args {
  const out: Partial<Args> = {};
  for (const arg of process.argv.slice(2)) {
    const m = arg.match(/^--(file|store|until)=(.+)$/);
    if (m) (out as Record<string, string>)[m[1]] = m[2];
  }
  if (!out.file || !out.store || !out.until) {
    console.error("Usage: tsx script/import-posnet-sales.ts --file=<xlsx> --store=<name> --until=YYYY-MM-DD");
    process.exit(1);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(out.until)) {
    console.error("--until must be YYYY-MM-DD");
    process.exit(1);
  }
  return out as Args;
}

const EXPECTED_HEADERS = ["SALES_DATE", "TOTAL_CASH", "TOTAL_CREDIT", "TOTAL_EFTPOS", "TOTAL_OTHERS"];

type Row = { date: string; cash: number; credit: number; eftpos: number; others: number };

function readSheet(file: string): Row[] {
  const wb = XLSX.readFile(file);
  if (!wb.SheetNames.includes("data")) {
    throw new Error(`Expected sheet "data", got: ${wb.SheetNames.join(", ")}`);
  }
  const ws = wb.Sheets["data"];
  const rawHeader = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1, range: 0, defval: "" })[0] || [];
  const headers = rawHeader.map((h) => String(h).trim());
  const missing = EXPECTED_HEADERS.filter((h) => !headers.includes(h));
  if (missing.length) {
    throw new Error(`Missing expected columns: ${missing.join(", ")}. Got: ${headers.join(", ")}`);
  }
  const rows = XLSX.utils.sheet_to_json<Record<string, string>>(ws, { defval: "", raw: false });
  return rows.map((r) => ({
    date: String(r.SALES_DATE).trim(),
    cash: parseFloat(String(r.TOTAL_CASH)) || 0,
    credit: parseFloat(String(r.TOTAL_CREDIT)) || 0,
    eftpos: parseFloat(String(r.TOTAL_EFTPOS)) || 0,
    others: parseFloat(String(r.TOTAL_OTHERS)) || 0,
  }));
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL env var is required");
    process.exit(1);
  }
  const args = parseArgs();
  console.log(`File:  ${args.file}`);
  console.log(`Store: ${args.store}`);
  console.log(`Until: ${args.until} (inclusive)`);

  const rows = readSheet(args.file);
  console.log(`Read ${rows.length} rows from sheet.`);

  // Filter by date cutoff and drop bad dates
  const filtered = rows.filter((r) => /^\d{4}-\d{2}-\d{2}$/.test(r.date) && r.date <= args.until);
  const dropped = rows.length - filtered.length;
  console.log(`Eligible rows (date <= ${args.until}): ${filtered.length}  (dropped ${dropped})`);

  // Gap report on the filtered window
  if (filtered.length > 0) {
    const set = new Set(filtered.map((r) => r.date));
    const start = filtered.reduce((min, r) => (r.date < min ? r.date : min), filtered[0].date);
    const end = filtered.reduce((max, r) => (r.date > max ? r.date : max), filtered[0].date);
    const gaps: string[] = [];
    for (let t = new Date(start).getTime(); t <= new Date(end).getTime(); t += 86_400_000) {
      const ymd = new Date(t).toISOString().slice(0, 10);
      if (!set.has(ymd)) gaps.push(ymd);
    }
    console.log(`Window: ${start} → ${end}`);
    console.log(`Gaps in window: ${gaps.length}${gaps.length ? ` (e.g. ${gaps.slice(0, 5).join(", ")})` : ""}`);
  }

  const pool = new Pool({
    connectionString: url,
    ssl: { rejectUnauthorized: false },
    max: 1,
  });

  try {
    const storeRes = await pool.query<{ id: string; name: string }>(
      "SELECT id, name FROM stores WHERE name = $1 LIMIT 1",
      [args.store],
    );
    if (storeRes.rowCount === 0) {
      console.error(`Store not found: ${args.store}`);
      process.exit(1);
    }
    const storeId = storeRes.rows[0].id;
    console.log(`Resolved store: ${storeRes.rows[0].name} (${storeId})`);

    let inserted = 0;
    let skipped = 0;
    let total = 0;
    for (const r of filtered) {
      const t = r.cash + r.credit + r.eftpos + r.others;
      total += t;
      const res = await pool.query(
        `INSERT INTO daily_sales (store_id, date, cash, credit, eftpos, others, total, source)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'posnet_import')
         ON CONFLICT (store_id, date) DO NOTHING`,
        [storeId, r.date, r.cash, r.credit, r.eftpos, r.others, t],
      );
      if (res.rowCount && res.rowCount > 0) inserted++;
      else skipped++;
    }

    console.log("---");
    console.log(`Inserted: ${inserted}`);
    console.log(`Skipped (already present): ${skipped}`);
    console.log(`Sum of totals (window): $${total.toFixed(2)}`);
  } finally {
    await pool.end().catch(() => {});
  }
}

main().catch((err) => {
  console.error("Import failed:", err.message);
  process.exit(1);
});
