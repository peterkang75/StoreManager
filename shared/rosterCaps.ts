// Pure, DB-free helpers for season-based roster hour caps.
// Dates are "YYYY-MM-DD" strings; weeks are Monday→Sunday (7 days).

export type Season = "TERM" | "HOLIDAY";
export type DayCategory = "SATURDAY" | "SUNDAY" | "PUBLIC_HOLIDAY" | "WEEKDAY";

export interface DateRange { startDate: string; endDate: string }

export interface HourCapConfig {
  weeklyTotalHours: number;
  saturdayHours: number;
  sundayHours: number;
  publicHolidayHours: number; // per public-holiday day
}

export interface ResolvedWeekCaps {
  season: Season;
  phDays: string[];            // public-holiday dates in the week the store is OPEN
  weeklyTotal: number;
  saturdayCap: number;
  sundayCap: number;
  publicHolidayCap: number;    // total = per-day * phDays.length
  weekdayPool: number;         // weeklyTotal - sat - sun - publicHolidayCap
}

/** All 7 YYYY-MM-DD dates of the Mon→Sun week starting at weekStart. */
export function weekDates(weekStart: string): string[] {
  const out: string[] = [];
  const d = new Date(weekStart + "T00:00:00");
  for (let i = 0; i < 7; i++) {
    const c = new Date(d);
    c.setDate(c.getDate() + i);
    const y = c.getFullYear();
    const m = String(c.getMonth() + 1).padStart(2, "0");
    const day = String(c.getDate()).padStart(2, "0");
    out.push(`${y}-${m}-${day}`);
  }
  return out;
}

/** True if dateStr is inside any [startDate, endDate] inclusive range. */
export function isInAnyRange(dateStr: string, ranges: DateRange[]): boolean {
  return ranges.some(r => dateStr >= r.startDate && dateStr <= r.endDate);
}

/**
 * Classify a week as HOLIDAY when the MAJORITY (>=4 of 7) of its days fall inside a
 * school-holiday range; otherwise TERM (ties / fewer => TERM).
 */
export function classifyWeekSeason(weekStart: string, holidayRanges: DateRange[]): Season {
  const inHoliday = weekDates(weekStart).filter(d => isInAnyRange(d, holidayRanges)).length;
  return inHoliday >= 4 ? "HOLIDAY" : "TERM";
}

/**
 * Day category for a date. Public-holiday takes precedence over weekend
 * (PH attracts the highest labour cost). phDays = PH dates the store is open.
 */
export function dayCategory(dateStr: string, phDays: string[]): DayCategory {
  if (phDays.includes(dateStr)) return "PUBLIC_HOLIDAY";
  const dow = new Date(dateStr + "T00:00:00").getDay(); // 0=Sun..6=Sat
  if (dow === 6) return "SATURDAY";
  if (dow === 0) return "SUNDAY";
  return "WEEKDAY";
}

/** Resolve the concrete caps for a week given its season config + the PH days. */
export function resolveWeekCaps(
  season: Season,
  config: HourCapConfig,
  phDays: string[],
): ResolvedWeekCaps {
  const publicHolidayCap = round2(config.publicHolidayHours * phDays.length);
  const weekdayPool = round2(
    config.weeklyTotalHours - config.saturdayHours - config.sundayHours - publicHolidayCap,
  );
  return {
    season,
    phDays,
    weeklyTotal: config.weeklyTotalHours,
    saturdayCap: config.saturdayHours,
    sundayCap: config.sundayHours,
    publicHolidayCap,
    weekdayPool,
  };
}

/** Sum rostered hours into the 4 categories. shifts: {date, hours}. */
export function sumByCategory(
  shifts: { date: string; hours: number }[],
  phDays: string[],
): Record<DayCategory, number> {
  const totals: Record<DayCategory, number> = {
    SATURDAY: 0, SUNDAY: 0, PUBLIC_HOLIDAY: 0, WEEKDAY: 0,
  };
  for (const s of shifts) totals[dayCategory(s.date, phDays)] += s.hours;
  (Object.keys(totals) as DayCategory[]).forEach(k => { totals[k] = round2(totals[k]); });
  return totals;
}

export interface CapBreach { category: DayCategory | "WEEKLY"; used: number; cap: number }

/**
 * Returns any breaches (used > cap). Empty array = within all caps.
 *
 * A sub-cap value of 0 means "NO LIMIT for that category" — it is not enforced.
 * So a store can enforce a pure weekly-total cap (e.g. 180 across all days, regardless
 * of day) by leaving Saturday/Sunday/public-holiday at 0 and setting only weeklyTotal.
 * The WEEKDAY pool is only enforced when a weekend/PH carve-out actually exists
 * (any of sat/sun/ph > 0); with no carve-out it equals the weekly total and would be
 * redundant. The weekly total is always enforced when set (> 0).
 */
export function findBreaches(
  caps: ResolvedWeekCaps,
  used: Record<DayCategory, number>,
): CapBreach[] {
  const total = round2(used.SATURDAY + used.SUNDAY + used.PUBLIC_HOLIDAY + used.WEEKDAY);
  const hasCarveOut = caps.saturdayCap > 0 || caps.sundayCap > 0 || caps.publicHolidayCap > 0;
  const out: CapBreach[] = [];
  if (caps.saturdayCap > 0 && used.SATURDAY > caps.saturdayCap + 1e-9)
    out.push({ category: "SATURDAY", used: used.SATURDAY, cap: caps.saturdayCap });
  if (caps.sundayCap > 0 && used.SUNDAY > caps.sundayCap + 1e-9)
    out.push({ category: "SUNDAY", used: used.SUNDAY, cap: caps.sundayCap });
  if (caps.publicHolidayCap > 0 && used.PUBLIC_HOLIDAY > caps.publicHolidayCap + 1e-9)
    out.push({ category: "PUBLIC_HOLIDAY", used: used.PUBLIC_HOLIDAY, cap: caps.publicHolidayCap });
  if (hasCarveOut && used.WEEKDAY > caps.weekdayPool + 1e-9)
    out.push({ category: "WEEKDAY", used: used.WEEKDAY, cap: caps.weekdayPool });
  if (caps.weeklyTotal > 0 && total > caps.weeklyTotal + 1e-9)
    out.push({ category: "WEEKLY", used: total, cap: caps.weeklyTotal });
  return out;
}

function round2(n: number): number { return Math.round(n * 100) / 100; }
