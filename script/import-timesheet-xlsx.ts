// Import a Connecteam "timeclock-timesheet_overview" xlsx (actual worked time)
// into the shift_timesheets table — the of-record table for worked hours.
//
// PURPOSE: historical preservation of pre-Crew timesheets. This importer is
// INSERT-ONLY and never touches any row already in the DB: if a shift_timesheet
// already exists for (employee, store, date) it is skipped, protecting all
// data the Crew app generated. Only dates with no existing record are imported.
//
// We read the "All Employees" sheet. Employee identity appears only on the
// first row of each person's block; following rows have blank name and belong
// to the same person (carry-forward). Each worked row (In & Out present) →
// one shift_timesheet row:
//   Start Date → date | In → actual_start_time | Out → actual_end_time
//   Type prefix → store (Sushi*→Sushi, Sandwich*→Sandwich, Head Office→HO)
//   First/Last (+ Nick) → employee | Employee/Manager notes → adjustment_reason
//   status = APPROVED (confirmed historical) | is_unscheduled = false
//
// created_at/updated_at are set to the shift's own date so these historical
// rows never trip the back-pay detector (which flags timesheets whose
// updated_at is AFTER an existing payroll's created_at). Hours are NOT stored —
// Crew computes them from start/end.
//
// Usage:
//   DATABASE_PUBLIC_URL='...' npx tsx script/import-timesheet-xlsx.ts \
//     --file='/path/to/timeclock-timesheet_overview_....xlsx' [--dry-run]

import pg from "pg";
import XLSX from "xlsx";

const { Pool } = pg;

type Args = { files: string[]; dryRun: boolean };

function parseArgs(): Args {
  const files: string[] = [];
  let dryRun = false;
  for (const arg of process.argv.slice(2)) {
    if (arg === "--dry-run") { dryRun = true; continue; }
    const m = arg.match(/^--file=(.+)$/);
    if (m) { files.push(m[1]); continue; }
    if (arg.toLowerCase().endsWith(".xlsx")) { files.push(arg); continue; } // bare path
  }
  if (!files.length) {
    console.error("Usage: tsx script/import-timesheet-xlsx.ts --file=<xlsx> [--file=<xlsx> ...] [--dry-run]");
    process.exit(1);
  }
  return { files, dryRun };
}

type RawRow = {
  first: string; last: string; nick: string;
  type: string;          // Sandwich_K1 / Head Office
  startDate: string;     // raw Start Date cell
  in: string; out: string;
  empNote: string; mgrNote: string;
};

const EXPECTED_HEADERS = ["First name", "Last name", "Type", "Start Date", "In", "Out"];

function readSheet(file: string): RawRow[] {
  const wb = XLSX.readFile(file);
  const sheetName = wb.SheetNames.includes("All Employees") ? "All Employees" : wb.SheetNames[0];
  if (!sheetName) throw new Error("No sheets in workbook");
  const ws = wb.Sheets[sheetName];
  // dateNF forces date cells to ISO yyyy-mm-dd regardless of the file's locale
  // formatting (this export uses Australian d/mm/yyyy, which would otherwise be
  // mis-parsed as m/d/yyyy). Time cells (In/Out) are stored as text and pass
  // through unchanged.
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: "", raw: false, dateNF: "yyyy-mm-dd" });
  const header = (matrix[0] || []).map((h) => String(h).trim());
  const missing = EXPECTED_HEADERS.filter((h) => !header.includes(h));
  if (missing.length) throw new Error(`Missing expected columns: ${missing.join(", ")}. Got: ${header.join(", ")}`);
  const idx = (name: string) => header.indexOf(name);
  const out: RawRow[] = [];
  // Carry forward the current person across blank-name continuation rows.
  let curFirst = "", curLast = "", curNick = "";
  for (let i = 1; i < matrix.length; i++) {
    const row = matrix[i];
    if (!row) continue;
    const fn = String(row[idx("First name")] ?? "").trim();
    const ln = String(row[idx("Last name")] ?? "").trim();
    const nk = String(row[idx("Nick Name")] ?? "").trim();
    if (fn || ln) { curFirst = fn; curLast = ln; curNick = nk; }
    out.push({
      first: curFirst, last: curLast, nick: curNick,
      type: String(row[idx("Type")] ?? "").trim(),
      startDate: String(row[idx("Start Date")] ?? "").trim(),
      in: String(row[idx("In")] ?? "").trim(),
      out: String(row[idx("Out")] ?? "").trim(),
      empNote: String(row[idx("Employee notes")] ?? "").trim(),
      mgrNote: String(row[idx("Manager notes")] ?? "").trim(),
    });
  }
  return out;
}

function isValidYMD(y: number, mo: number, d: number): boolean {
  return mo >= 1 && mo <= 12 && d >= 1 && d <= 31 && y >= 2000 && y <= 2100;
}

// Decide slash-date order from the data: if any first token > 12 it's D/M/Y; if
// any second token > 12 it's M/D/Y. (This Connecteam timesheet export uses
// Australian D/M/Y, while the roster export used US M/D/Y — never assume.)
function detectDayFirst(samples: string[]): boolean {
  let dayFirst = false, monthFirst = false;
  for (const s of samples) {
    const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (!m) continue;
    if (+m[1] > 12) dayFirst = true;
    if (+m[2] > 12) monthFirst = true;
  }
  if (monthFirst && !dayFirst) return false; // unambiguously M/D/Y
  return true; // D/M/Y, or ambiguous → default to D/M/Y (this export's locale)
}

// Accept "YYYY-MM-DD[ ...]" or slash dates → "YYYY-MM-DD". Returns null on any
// out-of-range date so a mis-parse surfaces as a skip instead of a bad insert.
function toYMD(s: string, dayFirst: boolean): string | null {
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) {
    const [y, mo, d] = [+m[1], +m[2], +m[3]];
    if (!isValidYMD(y, mo, d)) return null;
    return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  }
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) {
    const y = +m[3];
    const mo = dayFirst ? +m[2] : +m[1];
    const d = dayFirst ? +m[1] : +m[2];
    if (!isValidYMD(y, mo, d)) return null;
    return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  }
  return null;
}

// Accept "07:00" (24h) or "06:20am"/"02:20pm" → "HH:MM" 24h
function to24h(t: string): string | null {
  const s = t.toLowerCase().replace(/\s+/g, "");
  let m = s.match(/^(\d{1,2}):(\d{2})(am|pm)$/);
  if (m) {
    let h = parseInt(m[1], 10);
    if (m[3] === "am") { if (h === 12) h = 0; } else { if (h !== 12) h += 12; }
    return `${String(h).padStart(2, "0")}:${m[2]}`;
  }
  m = s.match(/^(\d{1,2}):(\d{2})$/);
  if (m) return `${m[1].padStart(2, "0")}:${m[2]}`;
  return null;
}

function typeToStoreName(type: string): string | null {
  const t = type.toLowerCase();
  if (t.startsWith("sushi")) return "Sushi";
  if (t.startsWith("sandwich")) return "Sandwich";
  if (t.startsWith("head")) return "HO";       // "Head Office"
  if (t.startsWith("meat")) return "Meat";
  return null;
}

async function main() {
  const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
  if (!url) { console.error("DATABASE_PUBLIC_URL or DATABASE_URL env var is required"); process.exit(1); }
  const args = parseArgs();
  if (args.dryRun) console.log("MODE: dry-run (read-only — no rows will be written)");
  console.log(`Files: ${args.files.length}`);

  const pool = new Pool({ connectionString: url, ssl: { rejectUnauthorized: false }, max: 1 });
  try {
    const storesRes = await pool.query<{ id: string; name: string }>("SELECT id, name FROM stores");
    const storeByName = new Map<string, string>();
    for (const s of storesRes.rows) storeByName.set(s.name.toLowerCase(), s.id);

    const empRes = await pool.query<{ id: string; first_name: string; last_name: string; nickname: string | null }>(
      "SELECT id, first_name, last_name, nickname FROM employees",
    );
    const empByFull = new Map<string, string>();
    const empByNickname = new Map<string, string>();
    const empByFirstName = new Map<string, string[]>();
    const empDisplayById = new Map<string, string>();
    for (const e of empRes.rows) empDisplayById.set(e.id, `${e.first_name ?? ""} ${e.last_name ?? ""}`.trim());
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

    // Same alias map as the roster importer — known spelling divergences.
    const NAME_ALIASES: Record<string, string> = {
      "puspa chhantyal": "puspa chhanntyal",
      "jagdish bhandari": "jagadish bhandari",
    };

    function lookupEmployee(first: string, last: string, nick: string): string | null {
      const full = `${first} ${last}`.trim().toLowerCase();
      const aliased = NAME_ALIASES[full] ?? full;
      const byFull = empByFull.get(aliased);
      if (byFull) return byFull;
      // nickname (export Nick column, then first token)
      const nk = nick.trim().toLowerCase();
      if (nk && empByNickname.get(nk)) return empByNickname.get(nk)!;
      const firstTok = aliased.split(/\s+/)[0] ?? "";
      const byNick = empByNickname.get(firstTok);
      if (byNick) return byNick;
      const cands = empByFirstName.get(firstTok);
      if (cands && cands.length === 1) return cands[0];
      return null;
    }

    type Resolved = {
      storeId: string; employeeId: string; date: string; startTime: string; endTime: string;
      reason: string | null; displayUser: string;
    };

    // Accumulators across all files.
    const unmatchedNames = new Set<string>();
    const unmappedTypes = new Set<string>();
    let gResolved = 0, gSkipped = 0, gInserted = 0, gProtected = 0, gWouldInsert = 0;

    async function processFile(file: string): Promise<void> {
      const name = file.split("/").pop();
      const raw = readSheet(file);
      const worked = raw.filter((r) => r.in && r.out);
      const resolved: Resolved[] = [];
      const skips: string[] = [];
      const dayFirst = detectDayFirst(worked.map((r) => r.startDate));

      for (const r of worked) {
        const storeName = typeToStoreName(r.type);
        if (!storeName) { skips.push(`type="${r.type}" — no store match (${r.first} ${r.last})`); unmappedTypes.add(r.type); continue; }
        const storeId = storeByName.get(storeName.toLowerCase());
        if (!storeId) { skips.push(`type="${r.type}" → ${storeName} — store not in DB`); continue; }

        const employeeId = lookupEmployee(r.first, r.last, r.nick);
        const display = `${r.first} ${r.last}`.trim();
        if (!employeeId) { skips.push(`user="${display}" — no employee match`); unmatchedNames.add(display); continue; }

        const date = toYMD(r.startDate, dayFirst);
        if (!date) { skips.push(`date="${r.startDate}" — bad date (${display})`); continue; }
        const startTime = to24h(r.in);
        const endTime = to24h(r.out);
        if (!startTime || !endTime) { skips.push(`time="${r.in}-${r.out}" — bad time (${display})`); continue; }

        const notes = [r.empNote, r.mgrNote].filter(Boolean).join(" | ") || null;
        resolved.push({ storeId, employeeId, date, startTime, endTime, reason: notes, displayUser: display });
      }

      const dates = resolved.map((r) => r.date).sort();
      const existingKeys = new Set<string>();
      if (resolved.length) {
        const ex = await pool.query<{ employee_id: string; store_id: string; date: string }>(
          `SELECT employee_id, store_id, date FROM shift_timesheets WHERE date >= $1 AND date <= $2`,
          [dates[0], dates[dates.length - 1]],
        );
        for (const e of ex.rows) existingKeys.add(`${e.employee_id}|${e.store_id}|${e.date}`);
      }
      const toInsert = resolved.filter((r) => !existingKeys.has(`${r.employeeId}|${r.storeId}|${r.date}`));
      const protectedCount = resolved.length - toInsert.length;
      const win = dates.length ? `${dates[0]}..${dates[dates.length - 1]}` : "-";

      let inserted = 0;
      if (!args.dryRun && toInsert.length) {
        // One transaction per file, chunked multi-row INSERTs to cut round-trips
        // (single-row inserts over the public DB URL are far too slow at scale).
        // created_at/updated_at = shift date so historical rows never trip the
        // back-pay detector (updated_at < any payroll's created_at).
        const CHUNK = 500;
        await pool.query("BEGIN");
        try {
          for (let i = 0; i < toInsert.length; i += CHUNK) {
            const chunk = toInsert.slice(i, i + CHUNK);
            const ph: string[] = [];
            const vals: unknown[] = [];
            chunk.forEach((r, j) => {
              const b = j * 7;
              ph.push(`($${b+1},$${b+2},$${b+3},$${b+4},$${b+5},'APPROVED',false,$${b+6},$${b+7},$${b+7})`);
              vals.push(r.storeId, r.employeeId, r.date, r.startTime, r.endTime, r.reason, `${r.date} 12:00:00`);
            });
            await pool.query(
              `INSERT INTO shift_timesheets
                 (store_id, employee_id, date, actual_start_time, actual_end_time, status, is_unscheduled, adjustment_reason, created_at, updated_at)
               VALUES ${ph.join(",")}`,
              vals,
            );
            inserted += chunk.length;
          }
          await pool.query("COMMIT");
        } catch (e) {
          await pool.query("ROLLBACK");
          throw e;
        }
      }

      gResolved += resolved.length; gSkipped += skips.length;
      gInserted += inserted; gProtected += protectedCount; gWouldInsert += toInsert.length;
      const fmt = dayFirst ? "D/M/Y" : "M/D/Y";
      const action = args.dryRun ? `would insert ${toInsert.length}` : `inserted ${inserted}`;
      console.log(`${name} | ${fmt} | ${win} | worked ${worked.length}, resolved ${resolved.length}, skip ${skips.length} | ${action}, protected ${protectedCount}`);
      for (const s of skips) console.log(`    skip: ${s}`);
    }

    for (const f of args.files) {
      try { await processFile(f); }
      catch (e) { console.log(`${f.split("/").pop()} | ERROR: ${(e as Error).message} — skipped`); }
    }

    console.log(`\n===== TOTAL (${args.files.length} files) =====`);
    console.log(`Resolved ${gResolved}, Skipped ${gSkipped}, ${args.dryRun ? `Would insert ${gWouldInsert}` : `Inserted ${gInserted}`}, Protected ${gProtected}`);
    if (unmatchedNames.size) console.log(`Unmatched names (need alias/check): ${[...unmatchedNames].sort().join(", ")}`);
    if (unmappedTypes.size) console.log(`Unmapped Types (no store): ${[...unmappedTypes].sort().join(", ")}`);
  } finally {
    await pool.end().catch(() => {});
  }
}

main().catch((err) => { console.error("Import failed:", err.message); process.exit(1); });
