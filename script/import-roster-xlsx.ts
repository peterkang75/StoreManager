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

type Args = { files: string[]; dryRun: boolean; publish: boolean; skipExisting: boolean };

function parseArgs(): Args {
  const files: string[] = [];
  let dryRun = false, publish = false, skipExisting = false;
  for (const arg of process.argv.slice(2)) {
    if (arg === "--dry-run") { dryRun = true; continue; }
    if (arg === "--publish") { publish = true; continue; }
    if (arg === "--skip-existing") { skipExisting = true; continue; }
    const m = arg.match(/^--file=(.+)$/);
    if (m) { files.push(m[1]); continue; }
    if (arg.toLowerCase().endsWith(".xlsx")) { files.push(arg); continue; } // bare path
  }
  if (!files.length) {
    console.error("Usage: tsx script/import-roster-xlsx.ts --file=<xlsx> [--file=<xlsx> ...] [--dry-run] [--publish] [--skip-existing]");
    process.exit(1);
  }
  return { files, dryRun, publish, skipExisting };
}

// Monday (YYYY-MM-DD) of the week containing the given date. Computed in UTC to
// match the server's getMondayStr() exactly (server runs in UTC), so the
// roster_publications rows we write line up with what the app queries.
function mondayOf(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const day = dt.getUTCDay(); // 0=Sun
  const diff = day === 0 ? -6 : 1 - day;
  dt.setUTCDate(dt.getUTCDate() + diff);
  return dt.toISOString().split("T")[0];
}

type RawRow = {
  date: string;        // MM/DD/YYYY
  start: string;       // 06:30am
  end: string;         // 04:00pm
  job: string;         // Sushi_K1
  user: string;        // Angy Tamang
};

// Only the columns we actually use — some newer Connecteam exports drop
// Timezone/Shift title/Address, so don't require them.
const EXPECTED_HEADERS = ["Date", "Start", "End", "Job", "Users"];

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

function isValidYMD(y: number, mo: number, d: number): boolean {
  return mo >= 1 && mo <= 12 && d >= 1 && d <= 31 && y >= 2000 && y <= 2100;
}

// Decide slash-date order from the data (never assume — the roster export is US
// M/D/Y but the timesheet export is Australian D/M/Y; a future file could flip).
function detectDayFirst(samples: string[]): boolean {
  let dayFirst = false, monthFirst = false;
  for (const s of samples) {
    const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (!m) continue;
    if (+m[1] > 12) dayFirst = true;
    if (+m[2] > 12) monthFirst = true;
  }
  if (dayFirst && !monthFirst) return true;
  return false; // M/D/Y, or ambiguous → default M/D/Y (this export's locale)
}

// slash date or ISO → YYYY-MM-DD; null on out-of-range so a mis-parse surfaces.
function toYMD(s: string, dayFirst: boolean): string | null {
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) {
    const [y, mo, d] = [+m[1], +m[2], +m[3]];
    return isValidYMD(y, mo, d) ? `${y}-${String(mo).padStart(2,"0")}-${String(d).padStart(2,"0")}` : null;
  }
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) {
    const y = +m[3];
    const mo = dayFirst ? +m[2] : +m[1];
    const d = dayFirst ? +m[1] : +m[2];
    return isValidYMD(y, mo, d) ? `${y}-${String(mo).padStart(2,"0")}-${String(d).padStart(2,"0")}` : null;
  }
  return null;
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
  // This script runs locally (outside Railway's network), so prefer the public
  // URL when present — DATABASE_URL on a Railway Postgres service is the
  // internal *.railway.internal host, which does not resolve from a laptop.
  const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_PUBLIC_URL or DATABASE_URL env var is required");
    process.exit(1);
  }
  const args = parseArgs();
  if (args.dryRun) console.log("MODE: dry-run (read-only — no rows will be written)");
  console.log(`Files: ${args.files.length}`);

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
    const empDisplayById = new Map<string, string>(); // id → "First Last" for dry-run reporting
    for (const e of empRes.rows) {
      empDisplayById.set(e.id, `${e.first_name ?? ""} ${e.last_name ?? ""}`.trim());
    }
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

    type Resolved = { storeId: string; employeeId: string; date: string; startTime: string; endTime: string };

    // Accumulators across all files.
    const unmatchedNames = new Set<string>();
    const allStoreWeeks = new Map<string, { storeId: string; weekStart: string }>();
    let gResolved = 0, gSkipped = 0, gInserted = 0, gProtected = 0, gOverwritten = 0, gWouldInsert = 0;

    async function processFile(file: string): Promise<void> {
      const name = file.split("/").pop();
      const raw = readSheet(file);
      const resolved: Resolved[] = [];
      const skips: string[] = [];
      const dayFirst = detectDayFirst(raw.map((r) => r.date));

      for (const r of raw) {
        const storeName = jobToStoreName(r.job);
        if (!storeName) { skips.push(`job="${r.job}" — no store match`); continue; }
        const storeId = storeByName.get(storeName.toLowerCase());
        if (!storeId) { skips.push(`job="${r.job}" → ${storeName} — store not in DB`); continue; }

        const employeeId = lookupEmployee(r.user);
        if (!employeeId) { skips.push(`user="${r.user}" — no employee match`); unmatchedNames.add(r.user); continue; }

        const date = toYMD(r.date, dayFirst);
        if (!date) { skips.push(`date="${r.date}" — bad date format`); continue; }
        const startTime = to24h(r.start);
        const endTime = to24h(r.end);
        if (!startTime || !endTime) { skips.push(`time="${r.start}-${r.end}" — bad time format`); continue; }

        resolved.push({ storeId, employeeId, date, startTime, endTime });
        allStoreWeeks.set(`${storeId}|${mondayOf(date)}`, { storeId, weekStart: mondayOf(date) });
      }

      // Snapshot existing (store, emp, date) once. Earlier files in this run are
      // already committed, so overlapping later files correctly see them.
      const dates = resolved.map((r) => r.date).sort();
      const existingKeys = new Set<string>();
      if (resolved.length) {
        const ex = await pool.query<{ store_id: string; employee_id: string; date: string }>(
          `SELECT store_id, employee_id, date FROM rosters WHERE date >= $1 AND date <= $2`,
          [dates[0], dates[dates.length - 1]],
        );
        for (const e of ex.rows) existingKeys.add(`${e.store_id}|${e.employee_id}|${e.date}`);
      }
      // Dedup within-file too (a person could appear twice for the same day).
      const seen = new Set<string>();
      const toInsert: Resolved[] = [];
      const existingResolved: Resolved[] = [];
      for (const r of resolved) {
        const key = `${r.storeId}|${r.employeeId}|${r.date}`;
        if (existingKeys.has(key)) { existingResolved.push(r); continue; }
        if (seen.has(key)) continue; // duplicate row in same file
        seen.add(key);
        toInsert.push(r);
      }
      const protectedCount = existingResolved.length;
      const win = dates.length ? `${dates[0]}..${dates[dates.length - 1]}` : "-";

      let inserted = 0, overwritten = 0;
      if (!args.dryRun) {
        await pool.query("BEGIN");
        try {
          // Chunked multi-row insert of new shifts (single-row inserts over the
          // public DB are too slow at scale).
          const CHUNK = 800;
          for (let i = 0; i < toInsert.length; i += CHUNK) {
            const chunk = toInsert.slice(i, i + CHUNK);
            const ph: string[] = [];
            const vals: unknown[] = [];
            chunk.forEach((r, j) => {
              const b = j * 5;
              ph.push(`($${b+1},$${b+2},$${b+3},$${b+4},$${b+5})`);
              vals.push(r.storeId, r.employeeId, r.date, r.startTime, r.endTime);
            });
            await pool.query(
              `INSERT INTO rosters (store_id, employee_id, date, start_time, end_time) VALUES ${ph.join(",")}`,
              vals,
            );
            inserted += chunk.length;
          }
          // Overwrite mode (NOT skip-existing): update existing rows' times.
          if (!args.skipExisting) {
            for (const r of existingResolved) {
              await pool.query(
                `UPDATE rosters SET start_time = $1, end_time = $2, updated_at = now()
                 WHERE store_id = $3 AND employee_id = $4 AND date = $5`,
                [r.startTime, r.endTime, r.storeId, r.employeeId, r.date],
              );
              overwritten++;
            }
          }
          await pool.query("COMMIT");
        } catch (e) {
          await pool.query("ROLLBACK");
          throw e;
        }
      }

      gResolved += resolved.length; gSkipped += skips.length; gWouldInsert += toInsert.length;
      gInserted += inserted; gOverwritten += overwritten;
      gProtected += args.skipExisting ? protectedCount : 0;
      const protNote = args.skipExisting ? `protected ${protectedCount}` : `overwrite ${args.dryRun ? existingResolved.length : overwritten}`;
      const act = args.dryRun ? `would insert ${toInsert.length}` : `inserted ${inserted}`;
      console.log(`${name} | ${dayFirst ? "D/M/Y" : "M/D/Y"} | ${win} | rows ${raw.length}, resolved ${resolved.length}, skip ${skips.length} | ${act}, ${protNote}`);
      for (const s of skips) console.log(`    skip: ${s}`);
    }

    for (const f of args.files) {
      try { await processFile(f); }
      catch (e) { console.log(`${f.split("/").pop()} | ERROR: ${(e as Error).message} — skipped`); }
    }

    // --publish: mark each touched (store, week) as published (idempotent).
    let pubInserted = 0, pubExisting = 0;
    if (args.publish && !args.dryRun) {
      for (const { storeId, weekStart } of allStoreWeeks.values()) {
        const existing = await pool.query<{ id: string }>(
          `SELECT id FROM roster_publications WHERE store_id = $1 AND week_start = $2 LIMIT 1`,
          [storeId, weekStart],
        );
        if (existing.rowCount && existing.rowCount > 0) pubExisting++;
        else { await pool.query(`INSERT INTO roster_publications (store_id, week_start) VALUES ($1, $2)`, [storeId, weekStart]); pubInserted++; }
      }
    }

    console.log(`\n===== TOTAL (${args.files.length} files) =====`);
    console.log(`Resolved ${gResolved}, Skipped ${gSkipped}, ${args.dryRun ? `Would insert ${gWouldInsert}` : `Inserted ${gInserted}`}` +
      (args.skipExisting ? `, Protected ${gProtected}` : `, Overwritten ${gOverwritten}`));
    if (args.publish) console.log(`Weeks touched: ${allStoreWeeks.size}` + (args.dryRun ? " (would publish)" : `, published ${pubInserted} new / ${pubExisting} existing`));
    if (unmatchedNames.size) console.log(`Unmatched names (need alias/check): ${[...unmatchedNames].sort().join(", ")}`);
  } finally {
    await pool.end().catch(() => {});
  }
}

main().catch((err) => {
  console.error("Import failed:", err.message);
  process.exit(1);
});
