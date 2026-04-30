// Import a Schedule-Export xlsx (one row per shift) into the rosters table.
// Idempotent — re-running with the same file overwrites the same
// (storeId, employeeId, date) rows.
//
// xlsx columns expected: Date | Start | End | Timezone | Shift title | Job |
//                        Users | Shift tags | Address
//
// Job → store mapping is by prefix: anything starting with "Sushi" → Sushi,
// anything starting with "Sandwich" → Sandwich. Other prefixes are skipped
// with a log line. User → employee is matched case-insensitively against
// "firstName lastName" and (as a fallback) the nickname.
//
// Usage:
//   DATABASE_URL='<railway public url>' npx tsx script/import-roster-xlsx.ts \
//     --file='/path/to/Schedule-Export ....xlsx'

import pg from "pg";
import XLSX from "xlsx";

const { Pool } = pg;

type Args = { file: string };

function parseArgs(): Args {
  const out: Partial<Args> = {};
  for (const arg of process.argv.slice(2)) {
    const m = arg.match(/^--(file)=(.+)$/);
    if (m) (out as Record<string, string>)[m[1]] = m[2];
  }
  if (!out.file) {
    console.error("Usage: tsx script/import-roster-xlsx.ts --file=<xlsx>");
    process.exit(1);
  }
  return out as Args;
}

type RawRow = {
  date: string;        // MM/DD/YYYY
  start: string;       // 06:30am
  end: string;         // 04:00pm
  job: string;         // Sushi_K1
  user: string;        // Angy Tamang
};

const EXPECTED_HEADERS = ["Date", "Start", "End", "Timezone", "Shift title", "Job", "Users", "Shift tags", "Address"];

function readSheet(file: string): RawRow[] {
  const wb = XLSX.readFile(file);
  const sheetName = wb.SheetNames[0];
  if (!sheetName) throw new Error("No sheets in workbook");
  const ws = wb.Sheets[sheetName];
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: "", raw: false });
  const header = (matrix[0] || []).map((h) => String(h).trim());
  const missing = EXPECTED_HEADERS.filter((h) => !header.includes(h));
  if (missing.length) throw new Error(`Missing expected columns: ${missing.join(", ")}. Got: ${header.join(", ")}`);
  const idx = (name: string) => header.indexOf(name);
  const out: RawRow[] = [];
  for (let i = 1; i < matrix.length; i++) {
    const row = matrix[i];
    if (!row || !row[idx("Date")]) continue;
    out.push({
      date: String(row[idx("Date")]).trim(),
      start: String(row[idx("Start")]).trim(),
      end: String(row[idx("End")]).trim(),
      job: String(row[idx("Job")]).trim(),
      user: String(row[idx("Users")]).trim(),
    });
  }
  return out;
}

// MM/DD/YYYY → YYYY-MM-DD
function toYMD(mdy: string): string | null {
  const m = mdy.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  const [, mm, dd, yyyy] = m;
  return `${yyyy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
}

// "06:30am" / "04:00pm" → "06:30" / "16:00"
function to24h(t: string): string | null {
  const m = t.toLowerCase().replace(/\s+/g, "").match(/^(\d{1,2}):(\d{2})(am|pm)$/);
  if (!m) return null;
  let [, hStr, mStr, ampm] = m;
  let h = parseInt(hStr, 10);
  if (ampm === "am") {
    if (h === 12) h = 0;
  } else {
    if (h !== 12) h += 12;
  }
  return `${String(h).padStart(2, "0")}:${mStr}`;
}

function jobToStoreName(job: string): string | null {
  const j = job.toLowerCase();
  if (j.startsWith("sushi")) return "Sushi";
  if (j.startsWith("sandwich")) return "Sandwich";
  return null;
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL env var is required");
    process.exit(1);
  }
  const args = parseArgs();
  console.log(`File: ${args.file}`);

  const raw = readSheet(args.file);
  console.log(`Read ${raw.length} shift rows.`);

  const pool = new Pool({ connectionString: url, ssl: { rejectUnauthorized: false }, max: 1 });
  try {
    // Stores
    const storesRes = await pool.query<{ id: string; name: string }>("SELECT id, name FROM stores");
    const storeByName = new Map<string, string>();
    for (const s of storesRes.rows) storeByName.set(s.name.toLowerCase(), s.id);

    // Employees
    const empRes = await pool.query<{ id: string; first_name: string; last_name: string; nickname: string | null; status: string }>(
      "SELECT id, first_name, last_name, nickname, status FROM employees",
    );
    const empByFull = new Map<string, string>();
    const empByNickname = new Map<string, string>();
    const empByFirstName = new Map<string, string[]>(); // first name → ids (may be multiple)
    for (const e of empRes.rows) {
      const full = `${e.first_name ?? ""} ${e.last_name ?? ""}`.trim().toLowerCase();
      if (full) empByFull.set(full, e.id);
      if (e.nickname) empByNickname.set(e.nickname.trim().toLowerCase(), e.id);
      if (e.first_name) {
        const fn = e.first_name.trim().toLowerCase();
        if (!empByFirstName.has(fn)) empByFirstName.set(fn, []);
        empByFirstName.get(fn)!.push(e.id);
      }
    }

    // Manual aliases for known name mismatches between the export and the
    // current employees table. Add new entries here when a name diverges
    // (e.g. typo in DB, abbreviation in export).
    const NAME_ALIASES: Record<string, string> = {
      "puspa chhantyal": "puspa chhanntyal",   // DB: Chhanntyal (extra n)
      "jagdish bhandari": "jagadish bhandari", // DB: Jagadish (extra a)
    };

    function lookupEmployee(rawUser: string): string | null {
      const userKey = rawUser.trim().toLowerCase();
      const aliasedKey = NAME_ALIASES[userKey] ?? userKey;
      // 1. Exact full-name match (with alias)
      const full = empByFull.get(aliasedKey);
      if (full) return full;
      // 2. Nickname match (use first token if multi-word like "Dawa D")
      const firstToken = aliasedKey.split(/\s+/)[0] ?? "";
      const nick = empByNickname.get(aliasedKey) ?? empByNickname.get(firstToken);
      if (nick) return nick;
      // 3. First-name match — only if exactly one employee has that first name
      const candidates = empByFirstName.get(firstToken);
      if (candidates && candidates.length === 1) return candidates[0];
      return null;
    }

    // Resolve and accumulate
    type Resolved = { storeId: string; employeeId: string; date: string; startTime: string; endTime: string };
    const resolved: Resolved[] = [];
    const skips: string[] = [];

    for (const r of raw) {
      const storeName = jobToStoreName(r.job);
      if (!storeName) { skips.push(`row job="${r.job}" — no store match`); continue; }
      const storeId = storeByName.get(storeName.toLowerCase());
      if (!storeId) { skips.push(`row job="${r.job}" → ${storeName} — store not found in DB`); continue; }

      const employeeId = lookupEmployee(r.user);
      if (!employeeId) { skips.push(`row user="${r.user}" — no employee match`); continue; }

      const date = toYMD(r.date);
      if (!date) { skips.push(`row date="${r.date}" — bad date format`); continue; }
      const startTime = to24h(r.start);
      const endTime = to24h(r.end);
      if (!startTime || !endTime) { skips.push(`row time="${r.start}-${r.end}" — bad time format`); continue; }

      resolved.push({ storeId, employeeId, date, startTime, endTime });
    }

    console.log(`Resolved: ${resolved.length}, Skipped: ${skips.length}`);
    if (skips.length) {
      console.log("--- Skips ---");
      for (const s of skips) console.log("  " + s);
    }

    // Manual upsert by (store_id, employee_id, date) — the rosters table has
    // no unique constraint, so we SELECT-then-UPDATE/INSERT for each row.
    let inserted = 0;
    let updated = 0;
    for (const r of resolved) {
      const existing = await pool.query<{ id: string }>(
        `SELECT id FROM rosters WHERE store_id = $1 AND employee_id = $2 AND date = $3 LIMIT 1`,
        [r.storeId, r.employeeId, r.date],
      );
      if (existing.rowCount && existing.rowCount > 0) {
        await pool.query(
          `UPDATE rosters SET start_time = $1, end_time = $2, updated_at = now() WHERE id = $3`,
          [r.startTime, r.endTime, existing.rows[0].id],
        );
        updated++;
      } else {
        await pool.query(
          `INSERT INTO rosters (store_id, employee_id, date, start_time, end_time) VALUES ($1, $2, $3, $4, $5)`,
          [r.storeId, r.employeeId, r.date, r.startTime, r.endTime],
        );
        inserted++;
      }
    }

    console.log(`Inserted: ${inserted}, Updated: ${updated}`);
    if (resolved.length > 0) {
      const dates = resolved.map((r) => r.date).sort();
      console.log(`Window: ${dates[0]} → ${dates[dates.length - 1]}`);
    }
  } finally {
    await pool.end().catch(() => {});
  }
}

main().catch((err) => {
  console.error("Import failed:", err.message);
  process.exit(1);
});
