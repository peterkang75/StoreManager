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

/** Returns any breaches (used > cap). Empty array = within all caps. */
export function findBreaches(
  caps: ResolvedWeekCaps,
  used: Record<DayCategory, number>,
): CapBreach[] {
  const total = round2(used.SATURDAY + used.SUNDAY + used.PUBLIC_HOLIDAY + used.WEEKDAY);
  const checks: CapBreach[] = [
    { category: "SATURDAY", used: used.SATURDAY, cap: caps.saturdayCap },
    { category: "SUNDAY", used: used.SUNDAY, cap: caps.sundayCap },
    { category: "PUBLIC_HOLIDAY", used: used.PUBLIC_HOLIDAY, cap: caps.publicHolidayCap },
    { category: "WEEKDAY", used: used.WEEKDAY, cap: caps.weekdayPool },
    { category: "WEEKLY", used: total, cap: caps.weeklyTotal },
  ];
  return checks.filter(c => c.used > c.cap + 1e-9);
}

function round2(n: number): number { return Math.round(n * 100) / 100; }
