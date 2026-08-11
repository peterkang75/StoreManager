// Roster-vs-actual merge model for the Attendance History screen.
//
// Approved timesheets say what happened; `rosters` says what was planned. Neither
// source alone answers "was the fortnight worked as rostered?" — a roster entry with
// no timesheet (the no-show) exists only in the roster, and an unrostered shift exists
// only in the timesheet. This module merges both into one cell per
// employee+date+store and classifies it.
//
// Pure — no React, no fetching.

import type { Employee, Roster } from "@shared/schema";
import { storeColorFor } from "@shared/storeColors";

// ── Date / time helpers ──────────────────────────────────────────────────────
// NOTE: parse date strings as LOCAL midnight (`+ "T00:00:00"`), never as bare
// `new Date("2026-07-13")` — the bare form is parsed as UTC and renders as the
// previous day in Sydney. Rosters.tsx uses the bare form; do not copy it here.

export function toYMD(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function addDays(dateStr: string, n: number): string {
  const d = new Date(dateStr + "T00:00:00");
  d.setDate(d.getDate() + n);
  return toYMD(d);
}

export function fmtDate(dateStr: string): string {
  return new Date(dateStr + "T00:00:00").toLocaleDateString("en-AU", {
    weekday: "short", day: "numeric", month: "short",
  });
}

export function fmtCycleDate(dateStr: string): string {
  return new Date(dateStr + "T00:00:00").toLocaleDateString("en-AU", {
    day: "2-digit", month: "short", year: "numeric",
  });
}

export function dayOfMonth(dateStr: string): number {
  return new Date(dateStr + "T00:00:00").getDate();
}

export function fmtTime(time: string | null): string {
  if (!time) return "—";
  const [h, m] = time.split(":").map(Number);
  const period = h >= 12 ? "PM" : "AM";
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${period}`;
}

/** "09:00" → 540. Unaware of day wrap by design; callers handle overnight. */
export function toMins(t: string | null | undefined): number {
  if (!t) return 0;
  const [h, m] = t.split(":").map(Number);
  return h * 60 + (m || 0);
}

/** Hours between two HH:MM times, wrapping past midnight (23:00→02:00 = 3h). */
export function calcHours(start: string, end: string): number {
  const diff = toMins(end) - toMins(start);
  return diff < 0 ? (diff + 1440) / 60 : diff / 60;
}

export function fmtHours(h: number): string {
  const hh = Math.floor(h);
  const mm = Math.round((h - hh) * 60);
  return mm === 0 ? `${hh}h` : `${hh}h ${mm}m`;
}

export function fmtDiffMinutes(diffMin: number): string {
  const abs = Math.abs(diffMin);
  const hh = Math.floor(abs / 60);
  const mm = Math.round(abs % 60);
  const sign = diffMin > 0 ? "+" : "-";
  if (hh === 0) return `${sign}${mm}m`;
  if (mm === 0) return `${sign}${hh}h`;
  return `${sign}${hh}h ${mm}m`;
}

export function fmtMoney(n: number): string {
  return `$${n.toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

// ── Types ────────────────────────────────────────────────────────────────────

/** Enriched approved timesheet as returned by GET /api/admin/approvals. */
export interface EnrichedTimesheet {
  id: string;
  date: string;
  storeId: string;
  storeName: string;
  storeCode: string;
  employeeId: string;
  employeeName: string;
  employeeNickname: string | null;
  actualStartTime: string;
  actualEndTime: string;
  scheduledStartTime: string | null;
  scheduledEndTime: string | null;
  status: string;
  adjustmentReason: string | null;
  isUnscheduled: boolean;
  createdAt: string;
}

export type CellStatus = "MATCH" | "DIFF" | "NO_SHOW" | "UNSCHEDULED";

export interface AttendanceEntry {
  employeeId: string;
  date: string;
  storeId: string;
  storeName: string;
  storeColor: string;
  roster: { start: string; end: string; hours: number } | null;
  actual: {
    id: string; start: string; end: string; hours: number; isUnscheduled: boolean;
    /**
     * Why the worked time differs from the roster. The employee portal makes this
     * mandatory whenever they change either time (EmployeePortal.tsx `canSubmit`),
     * so it is the staff member's own explanation for the difference. Blank and
     * whitespace-only values are normalised to null — imported history and some
     * manager edit paths leave the column set but empty.
     */
    reason: string | null;
  } | null;
  /** actual − roster, in minutes. 0 when either side is missing. */
  diffMinutes: number;
  status: CellStatus;
}

export interface AttendanceRow {
  employeeId: string;
  displayName: string;
  fullName: string;
  /** date (YYYY-MM-DD) → entries on that date. Usually 1; 2 on dual-store days. */
  cells: Map<string, AttendanceEntry[]>;
  rosterHours: number;
  actualHours: number;
  /**
   * actual − roster across the cycle, in minutes. Derived from the HOUR TOTALS, not
   * from summing per-cell `diffMinutes` — a NO_SHOW cell has no per-cell diff, so
   * summing cells would silently drop the missed hours and report a no-show employee
   * as roughly on-target.
   */
  diffMinutes: number;
  storeNames: string[];
  noShowCount: number;
  unscheduledCount: number;
}

export interface AttendanceModel {
  rows: AttendanceRow[];
  totalRosterHours: number;
  totalActualHours: number;
  totalDiffMinutes: number;
  /** True when the cycle has no roster data at all — pre-2025-04-14 cycles. */
  hasRosterData: boolean;
}

// ── Merge ────────────────────────────────────────────────────────────────────

const entryKey = (employeeId: string, date: string, storeId: string) =>
  `${employeeId}|${date}|${storeId}`;

function classify(
  roster: AttendanceEntry["roster"],
  actual: AttendanceEntry["actual"],
  diffMinutes: number,
): CellStatus {
  if (roster && actual) return diffMinutes === 0 ? "MATCH" : "DIFF";
  if (roster) return "NO_SHOW";
  return "UNSCHEDULED";
}

/**
 * Merge approved timesheets with roster entries into per-employee rows.
 *
 * Rows are the UNION of employees who have a roster in the cycle and employees who
 * have an approved timesheet. Keying rows off timesheets alone would hide an employee
 * rostered all fortnight who never clocked in — the row a manager most needs to see.
 *
 * Both inputs must already be narrowed to the cycle date range and (if filtering) to
 * the selected store. Filter at ENTRY level, not row level: an employee working both
 * stores would otherwise carry the other store's hours into their totals.
 */
export function buildAttendanceModel(
  timesheets: EnrichedTimesheet[],
  rosters: Roster[],
  storeNameById: Map<string, string>,
  employeesById: Map<string, Employee>,
): AttendanceModel {
  const entries = new Map<string, AttendanceEntry>();

  const ensure = (employeeId: string, date: string, storeId: string): AttendanceEntry => {
    const key = entryKey(employeeId, date, storeId);
    let e = entries.get(key);
    if (!e) {
      const storeName = storeNameById.get(storeId) ?? "Unknown";
      e = {
        employeeId, date, storeId, storeName,
        storeColor: storeColorFor(storeName),
        roster: null, actual: null, diffMinutes: 0, status: "NO_SHOW",
      };
      entries.set(key, e);
    }
    return e;
  };

  rosters.forEach(r => {
    const e = ensure(r.employeeId, r.date, r.storeId);
    e.roster = { start: r.startTime, end: r.endTime, hours: calcHours(r.startTime, r.endTime) };
  });

  timesheets.forEach(ts => {
    const e = ensure(ts.employeeId, ts.date, ts.storeId);
    // Prefer the store name the API resolved — it is authoritative for this row.
    if (ts.storeName && ts.storeName !== "Unknown") {
      e.storeName = ts.storeName;
      e.storeColor = storeColorFor(ts.storeName);
    }
    e.actual = {
      id: ts.id,
      start: ts.actualStartTime,
      end: ts.actualEndTime,
      hours: calcHours(ts.actualStartTime, ts.actualEndTime),
      isUnscheduled: ts.isUnscheduled,
      reason: ts.adjustmentReason?.trim() ? ts.adjustmentReason.trim() : null,
    };
  });

  // Names: timesheets carry them, but a roster-only employee has no timesheet row.
  const nameFromTimesheet = new Map<string, { display: string; full: string }>();
  timesheets.forEach(ts => {
    if (!nameFromTimesheet.has(ts.employeeId)) {
      nameFromTimesheet.set(ts.employeeId, {
        display: ts.employeeNickname || ts.employeeName.split(" ")[0],
        full: ts.employeeName,
      });
    }
  });

  const resolveName = (employeeId: string): { display: string; full: string } => {
    const fromTs = nameFromTimesheet.get(employeeId);
    if (fromTs) return fromTs;
    const emp = employeesById.get(employeeId);
    if (emp) {
      const full = `${emp.firstName} ${emp.lastName}`.trim();
      return { display: emp.nickname || emp.firstName, full };
    }
    return { display: "Unknown", full: "Unknown" };
  };

  const rowMap = new Map<string, AttendanceRow>();

  entries.forEach(e => {
    e.diffMinutes = e.roster && e.actual
      ? Math.round((e.actual.hours - e.roster.hours) * 60)
      : 0;
    e.status = classify(e.roster, e.actual, e.diffMinutes);

    let row = rowMap.get(e.employeeId);
    if (!row) {
      const { display, full } = resolveName(e.employeeId);
      row = {
        employeeId: e.employeeId,
        displayName: display,
        fullName: full,
        cells: new Map(),
        rosterHours: 0,
        actualHours: 0,
        diffMinutes: 0,
        storeNames: [],
        noShowCount: 0,
        unscheduledCount: 0,
      };
      rowMap.set(e.employeeId, row);
    }

    const onDate = row.cells.get(e.date) ?? [];
    onDate.push(e);
    onDate.sort((a, b) => a.storeName.localeCompare(b.storeName));
    row.cells.set(e.date, onDate);

    row.rosterHours += e.roster?.hours ?? 0;
    row.actualHours += e.actual?.hours ?? 0;
    if (e.status === "NO_SHOW") row.noShowCount += 1;
    if (e.status === "UNSCHEDULED") row.unscheduledCount += 1;
    if (!row.storeNames.includes(e.storeName)) row.storeNames.push(e.storeName);
  });

  const rows = Array.from(rowMap.values()).sort((a, b) =>
    a.displayName.localeCompare(b.displayName)
  );
  rows.forEach(r => {
    r.storeNames.sort();
    r.diffMinutes = hoursDiffMinutes(r.actualHours, r.rosterHours);
  });

  const totalRosterHours = rows.reduce((s, r) => s + r.rosterHours, 0);
  const totalActualHours = rows.reduce((s, r) => s + r.actualHours, 0);

  return {
    rows,
    totalRosterHours,
    totalActualHours,
    totalDiffMinutes: hoursDiffMinutes(totalActualHours, totalRosterHours),
    hasRosterData: rosters.length > 0,
  };
}

/**
 * Difference between two hour totals, in minutes. Always derive aggregate diffs this
 * way rather than by summing per-cell diffs — see `AttendanceRow.diffMinutes`.
 */
export function hoursDiffMinutes(actualHours: number, rosterHours: number): number {
  return Math.round((actualHours - rosterHours) * 60);
}

// ── Timeline bar colours ─────────────────────────────────────────────────────

function relativeLuminance(hex: string): number {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map(c => c + c).join("") : h;
  const [r, g, b] = [0, 2, 4].map(i => parseInt(full.slice(i, i + 2), 16) / 255);
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function mixWithWhite(hex: string, amount: number): string {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map(c => c + c).join("") : h;
  const parts = [0, 2, 4].map(i => {
    const v = parseInt(full.slice(i, i + 2), 16);
    return Math.round(v + (255 - v) * amount);
  });
  return `#${parts.map(p => p.toString(16).padStart(2, "0")).join("")}`;
}

const contrastRatio = (a: number, b: number) =>
  (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);

/** `--background` in dark mode: hsl(20 14% 4%) — see client/src/index.css. */
const DARK_BG_LUMINANCE = relativeLuminance("#0b0a09");

/**
 * Per-theme colours for a timeline "actual" bar.
 *
 * The bar must always read as the SOLID element against the pale roster band. A
 * literal brand hex breaks that in one theme: Sushi is `#222222`, which on the dark
 * background sits nearly flush with the page while the band (a light-tinted overlay)
 * becomes the more visible of the two — exactly inverting the faint/bold relationship
 * this view exists to show.
 *
 * The test is CONTRAST against the dark background, not raw luminance. Saturated
 * Sandwich red (#ef4444) is low-luminance but reads perfectly well on dark and must
 * keep its brand identity; near-neutral Sushi black does not. Only colours that
 * actually fail the contrast check get lightened, and only until they pass.
 */
export function timelineBarColors(hex: string): {
  bgLight: string; fgLight: string; bgDark: string; fgDark: string;
} {
  const lum = relativeLuminance(hex);

  let bgDark = hex;
  for (let mix = 0; mix <= 0.9; mix += 0.1) {
    bgDark = mix === 0 ? hex : mixWithWhite(hex, mix);
    if (contrastRatio(relativeLuminance(bgDark), DARK_BG_LUMINANCE) >= 3) break;
  }

  return {
    bgLight: hex,
    fgLight: lum > 0.45 ? "#111111" : "#ffffff",
    bgDark,
    fgDark: relativeLuminance(bgDark) > 0.45 ? "#111111" : "#ffffff",
  };
}

/** All entries on one date across every row, for the timeline's per-day view. */
export function entriesForDate(rows: AttendanceRow[], date: string): {
  row: AttendanceRow;
  entry: AttendanceEntry;
}[] {
  const out: { row: AttendanceRow; entry: AttendanceEntry }[] = [];
  rows.forEach(row => {
    (row.cells.get(date) ?? []).forEach(entry => out.push({ row, entry }));
  });
  return out;
}
