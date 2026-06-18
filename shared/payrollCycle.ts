/**
 * Payroll Cycle Configuration
 *
 * Cycles are 14 days (2 weeks), always starting on a Monday.
 * Anchor = first known cycle start (Monday, March 9, 2026).
 *
 * Rules:
 *  - Employees may submit timesheets for any past day within the current open cycle.
 *  - Once a cycle's last day (Sunday) passes, the window closes at midnight.
 *  - Unsubmitted shifts from a closed cycle are auto-submitted with roster times.
 */

export const PAYROLL_CYCLE_ANCHOR = "2026-03-09"; // Monday — first cycle start
export const PAYROLL_CYCLE_DAYS  = 14;

function toYMD(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Start date (Monday) of the payroll cycle that contains dateStr. */
export function getPayrollCycleStart(dateStr: string): string {
  const anchor = new Date(PAYROLL_CYCLE_ANCHOR + "T00:00:00");
  const target = new Date(dateStr + "T00:00:00");
  const daysDiff = Math.round((target.getTime() - anchor.getTime()) / 86_400_000);
  const idx = Math.floor(daysDiff / PAYROLL_CYCLE_DAYS);
  const start = new Date(anchor);
  start.setDate(start.getDate() + idx * PAYROLL_CYCLE_DAYS);
  return toYMD(start);
}

/** End date (Sunday) of a cycle given its start date. */
export function getPayrollCycleEnd(cycleStart: string): string {
  const d = new Date(cycleStart + "T00:00:00");
  d.setDate(d.getDate() + PAYROLL_CYCLE_DAYS - 1);
  return toYMD(d);
}

/** Add (or subtract) N days to a YYYY-MM-DD string. */
export function shiftDate(dateStr: string, days: number): string {
  const d = new Date(dateStr + "T00:00:00");
  d.setDate(d.getDate() + days);
  return toYMD(d);
}

/**
 * True if dateStr falls within the same open payroll cycle as todayStr.
 * (i.e., both dates share the same cycleStart)
 */
export function isDateInOpenCycle(dateStr: string, todayStr: string): boolean {
  return getPayrollCycleStart(dateStr) === getPayrollCycleStart(todayStr);
}

/**
 * Timesheet-approval deadline for a cycle.
 *
 * Managers must finish approvals by the END of the Monday that follows the cycle's
 * Sunday end date ("그 다음 월요일 자정까지"). That Monday is the buffer day:
 * for a cycle ending Sun, approvals stay open through all of the next Mon and the
 * cycle LOCKS at 00:00 (Sydney) on the following Tuesday.
 *
 * - getApprovalDeadlineMonday(cycleStart) → "YYYY-MM-DD" of the buffer Monday (display).
 * - getApprovalLockDate(cycleStart)       → "YYYY-MM-DD" of the first locked day (Tue).
 * - isCycleApprovalClosed(cycleStart, sydneyTodayStr) → true once today reaches lock day.
 *
 * sydneyTodayStr MUST be a Sydney-local "YYYY-MM-DD" (callers compute it, keeping
 * these helpers pure and DST-agnostic).
 */
export function getApprovalDeadlineMonday(cycleStart: string): string {
  return shiftDate(getPayrollCycleEnd(cycleStart), 1); // Sun + 1 = Mon
}

export function getApprovalLockDate(cycleStart: string): string {
  return shiftDate(getPayrollCycleEnd(cycleStart), 2); // Sun + 2 = Tue (first locked day)
}

export function isCycleApprovalClosed(cycleStart: string, sydneyTodayStr: string): boolean {
  return sydneyTodayStr >= getApprovalLockDate(cycleStart);
}
