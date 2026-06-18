# Roster Hour Caps (Phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enforce per-store, per-season (Term/Holiday) weekly staff-hour caps in the roster builder, with automatic season detection from NSW school-holiday dates.

**Architecture:** A new `store_hour_caps` table holds per-store/season caps (weekly total + Saturday + Sunday + per-public-holiday). A single server function `getWeekCaps(storeId, weekStart)` classifies the week (Term vs Holiday by majority of days vs `schoolHolidays`), resolves the public-holiday days for that store, and returns resolved category caps + the weekday pool. The roster builder displays usage-vs-cap and the Publish endpoint re-validates server-side (block-at-publish). NSW holiday dates are bundled as a constant and loaded into `schoolHolidays` via a button.

**Tech Stack:** TypeScript, Express, Drizzle ORM (Postgres), React + TanStack Query, Tailwind. No unit-test runner exists — pure logic is verified with standalone `npx tsx` scripts under `script/`; everything else with `npm run build`, `npm run check` (filtered), and manual runtime checks.

**Conventions (read before starting):**
- Migrations are idempotent SQL strings in `server/bootstrap-migrations.ts` (`IF NOT EXISTS`), run on boot.
- `req.user.role` is populated for all `/api/*` (global `requireAuth`); `ADMIN` bypasses gates.
- Roster week is Monday→Sunday; `weekStart` is a `YYYY-MM-DD` Monday. Dates are `YYYY-MM-DD` strings (lexicographic compare is valid). Business timezone is `Australia/Sydney`.
- `npm run check` (tsc) has many PRE-EXISTING errors (MemStorage looseness, downlevelIteration). After each task, only verify NO NEW errors appear in the files you touched: `npx tsc --noEmit 2>&1 | grep <yourfile>`.
- Commit messages end with: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

---

## File Structure

- Create `shared/rosterCaps.ts` — pure season/category/cap math (no DB). Shared by server.
- Create `shared/nswSchoolHolidays.ts` — bundled NSW break-period dataset.
- Create `script/verify-roster-caps.ts` — tsx assertion script for the pure logic.
- Modify `shared/schema.ts` — add `storeHourCaps` table + insert schema + types.
- Modify `server/bootstrap-migrations.ts` — create `store_hour_caps`, seed from `store_recommended_hours`.
- Modify `server/storage.ts` — `getStoreHourCaps` / `upsertStoreHourCap` (interface + DatabaseStorage + MemStorage).
- Modify `server/routes.ts` — `getWeekCaps()` helper; `GET /api/rosters/week-caps`; `GET`/`PUT /api/store-config/hour-caps`; `POST /api/store-config/school-holidays/load-nsw`; cap validation inside `POST /api/rosters/publish`.
- Modify `client/src/pages/admin/StoreConfig.tsx` — rework "Recommended Hours" tab into "Hour Caps"; add "Load NSW holidays" button + fix VIC→NSW label.
- Modify `client/src/pages/admin/Rosters.tsx` — fetch week-caps, show season badge + per-category usage/cap, disable Publish when over cap.
- Modify `plan.md` — feature note.

---

## Task 1: Pure season + cap math module

**Files:**
- Create: `shared/rosterCaps.ts`
- Create: `script/verify-roster-caps.ts`

- [ ] **Step 1: Create `shared/rosterCaps.ts`**

```typescript
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
```

- [ ] **Step 2: Create `script/verify-roster-caps.ts`**

```typescript
import assert from "node:assert";
import {
  classifyWeekSeason, dayCategory, resolveWeekCaps, sumByCategory, findBreaches, weekDates,
} from "../shared/rosterCaps";

// weekDates
assert.deepEqual(weekDates("2026-06-01").length, 7);
assert.equal(weekDates("2026-06-01")[6], "2026-06-07");

// season: a week fully inside a holiday range
const ranges = [{ startDate: "2026-07-06", endDate: "2026-07-17" }];
assert.equal(classifyWeekSeason("2026-07-06", ranges), "HOLIDAY");
// week with no overlap => TERM
assert.equal(classifyWeekSeason("2026-06-01", ranges), "TERM");
// straddle: holiday starts Thu 2026-07-02 .. so week 2026-06-29 has Thu,Fri,Sat,Sun = 4 => HOLIDAY
assert.equal(classifyWeekSeason("2026-06-29", [{ startDate: "2026-07-02", endDate: "2026-07-12" }]), "HOLIDAY");
// straddle minority: holiday starts Sat 2026-07-04 => week 2026-06-29 has Sat,Sun = 2 => TERM
assert.equal(classifyWeekSeason("2026-06-29", [{ startDate: "2026-07-04", endDate: "2026-07-12" }]), "TERM");

// dayCategory: PH precedence
assert.equal(dayCategory("2026-06-06", []), "SATURDAY");       // Sat
assert.equal(dayCategory("2026-06-07", []), "SUNDAY");         // Sun
assert.equal(dayCategory("2026-06-03", []), "WEEKDAY");        // Wed
assert.equal(dayCategory("2026-06-06", ["2026-06-06"]), "PUBLIC_HOLIDAY"); // Sat that is a PH

// resolve + breaches
const caps = resolveWeekCaps("TERM",
  { weeklyTotalHours: 38, saturdayHours: 8, sundayHours: 6, publicHolidayHours: 5 },
  ["2026-06-03"]); // one PH on a Wed
assert.equal(caps.publicHolidayCap, 5);
assert.equal(caps.weekdayPool, 38 - 8 - 6 - 5); // 19
const used = sumByCategory([
  { date: "2026-06-06", hours: 9 }, // Sat 9 > 8 cap
  { date: "2026-06-03", hours: 5 }, // PH 5 ok
  { date: "2026-06-01", hours: 10 }, // weekday
], caps.phDays);
const breaches = findBreaches(caps, used);
assert.ok(breaches.some(b => b.category === "SATURDAY"));
console.log("OK: roster-caps logic verified");
```

- [ ] **Step 3: Run the verification script — expect PASS**

Run: `npx tsx script/verify-roster-caps.ts`
Expected: prints `OK: roster-caps logic verified` and exits 0. (If an assert fires, fix the logic in `shared/rosterCaps.ts`.)

- [ ] **Step 4: Type-check the new file**

Run: `npx tsc --noEmit 2>&1 | grep -E "rosterCaps|verify-roster-caps" || echo CLEAN`
Expected: `CLEAN`

- [ ] **Step 5: Commit**

```bash
git add shared/rosterCaps.ts script/verify-roster-caps.ts
git commit -m "Roster caps: pure season/category/cap math + verification script

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: NSW school-holiday bundled dataset

**Files:**
- Create: `shared/nswSchoolHolidays.ts`

> The DATES are external facts. Do NOT invent them. Fetch from the official source
> (`https://education.nsw.gov.au/schooling/calendars/2026` and the equivalent 2025/2027
> pages, or the NSW "school development days and holidays" page) and transcribe the four
> break periods per year. NSW government schools use statewide term dates; school holidays
> are the gaps BETWEEN terms plus the summer break. Each entry covers the first non-school
> day to the last non-school day inclusive.

- [ ] **Step 1: Fetch the official NSW term/holiday dates**

Use WebFetch on the NSW education calendar pages for 2025, 2026, 2027. Record, per year,
the 4 break periods (Autumn = after Term 1, Winter = after Term 2, Spring = after Term 3,
Summer = after Term 4 into the next year). Note the summer break spans year boundaries
(e.g. late Dec 2026 → late Jan 2027) — store it as one range.

- [ ] **Step 2: Create `shared/nswSchoolHolidays.ts`** (fill the ranges from Step 1)

```typescript
// Official NSW (statewide government-school) school-holiday break periods.
// Source: education.nsw.gov.au school calendars. Update this list as NSW publishes
// new years. Each range is inclusive (first to last non-school day).
import type { DateRange } from "./rosterCaps";

export interface NswHolidayPeriod extends DateRange { name: string }

export const NSW_SCHOOL_HOLIDAYS: NswHolidayPeriod[] = [
  // --- 2026 (TRANSCRIBE EXACT DATES FROM STEP 1) ---
  { name: "Autumn Holidays 2026", startDate: "2026-__-__", endDate: "2026-__-__" },
  { name: "Winter Holidays 2026", startDate: "2026-__-__", endDate: "2026-__-__" },
  { name: "Spring Holidays 2026", startDate: "2026-__-__", endDate: "2026-__-__" },
  { name: "Summer Holidays 2026/27", startDate: "2026-__-__", endDate: "2027-__-__" },
  // --- add 2025 and 2027 entries the same way ---
];
```

- [ ] **Step 3: Replace every `__` with real dates from Step 1.** Verify there are no
remaining `__` placeholders:

Run: `grep -n "__" shared/nswSchoolHolidays.ts && echo "STILL HAS PLACEHOLDERS" || echo OK`
Expected: `OK`

- [ ] **Step 4: Sanity-check the dataset**

```bash
npx tsx -e 'import {NSW_SCHOOL_HOLIDAYS as h} from "./shared/nswSchoolHolidays"; for (const p of h){ if(!(p.startDate<=p.endDate)) throw new Error("bad range "+p.name); } console.log(h.length+" periods OK");'
```
Expected: prints `N periods OK` (N = number of periods, ≥4 per year).

- [ ] **Step 5: Commit**

```bash
git add shared/nswSchoolHolidays.ts
git commit -m "Roster caps: bundled NSW school-holiday dataset

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: `store_hour_caps` schema + migration (seed from recommended hours)

**Files:**
- Modify: `shared/schema.ts` (near `storeRecommendedHours`, ~line 975)
- Modify: `server/bootstrap-migrations.ts` (append to STATEMENTS array, before closing `];`)

- [ ] **Step 1: Add the table to `shared/schema.ts`** (immediately after the
`storeRecommendedHours` block)

```typescript
// Enforced per-store, per-season staff-hour caps for rostering. One row per
// (store, season). Replaces the advisory storeRecommendedHours at roster time;
// weekly_total_hours is seeded from storeRecommendedHours on migration.
export const storeHourCaps = pgTable("store_hour_caps", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  storeId: varchar("store_id").references(() => stores.id).notNull(),
  season: text("season").notNull(), // 'TERM' | 'HOLIDAY'
  weeklyTotalHours: real("weekly_total_hours").default(38).notNull(),
  saturdayHours: real("saturday_hours").default(0).notNull(),
  sundayHours: real("sunday_hours").default(0).notNull(),
  publicHolidayHours: real("public_holiday_hours").default(0).notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  storeSeasonUniq: uniqueIndex("shc_store_season_uniq").on(table.storeId, table.season),
}));

export const insertStoreHourCapSchema = createInsertSchema(storeHourCaps).omit({
  id: true,
  updatedAt: true,
});

export type InsertStoreHourCap = z.infer<typeof insertStoreHourCapSchema>;
export type StoreHourCap = typeof storeHourCaps.$inferSelect;
```

- [ ] **Step 2: Add the migration + seed to `server/bootstrap-migrations.ts`** (append
inside the `STATEMENTS` array, before the closing `];`)

```typescript
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
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit 2>&1 | grep -E "schema.ts|bootstrap-migrations" | grep -i "storeHourCaps\|store_hour_caps" || echo CLEAN`
Expected: `CLEAN` (pre-existing schema.ts errors at other lines are unrelated.)

- [ ] **Step 4: Build**

Run: `npm run build 2>&1 | tail -3`
Expected: build completes (`Done`).

- [ ] **Step 5: Commit**

```bash
git add shared/schema.ts server/bootstrap-migrations.ts
git commit -m "Roster caps: store_hour_caps table + seed from recommended hours

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Storage methods for hour caps

**Files:**
- Modify: `server/storage.ts` — import (line ~54), interface (near `getStoreRecommendedHours` ~line 358), DatabaseStorage impl (near `upsertStoreRecommendedHours` ~3975), MemStorage impl.

- [ ] **Step 1: Add to the `@shared/schema` import block** (line ~54-56)

Add `storeHourCaps, type StoreHourCap, type InsertStoreHourCap` to the existing import list.

- [ ] **Step 2: Add interface declarations** (right after the
`upsertStoreRecommendedHours` line in the `IStorage` interface)

```typescript
  getStoreHourCaps(storeId?: string): Promise<StoreHourCap[]>;
  upsertStoreHourCap(data: InsertStoreHourCap): Promise<StoreHourCap>;
```

- [ ] **Step 3: Add DatabaseStorage implementation** (right after the
`upsertStoreRecommendedHours` method in `DatabaseStorage`)

```typescript
  async getStoreHourCaps(storeId?: string): Promise<StoreHourCap[]> {
    if (storeId) {
      return db.select().from(storeHourCaps).where(eq(storeHourCaps.storeId, storeId));
    }
    return db.select().from(storeHourCaps);
  }

  async upsertStoreHourCap(data: InsertStoreHourCap): Promise<StoreHourCap> {
    const [row] = await db.insert(storeHourCaps)
      .values({ ...data, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: [storeHourCaps.storeId, storeHourCaps.season],
        set: {
          weeklyTotalHours: data.weeklyTotalHours,
          saturdayHours: data.saturdayHours,
          sundayHours: data.sundayHours,
          publicHolidayHours: data.publicHolidayHours,
          updatedAt: new Date(),
        },
      })
      .returning();
    return row;
  }
```

- [ ] **Step 4: Add MemStorage implementation** (near the other recommended-hours stubs in `MemStorage`)

```typescript
  private storeHourCapsList: StoreHourCap[] = [];
  async getStoreHourCaps(storeId?: string): Promise<StoreHourCap[]> {
    return storeId ? this.storeHourCapsList.filter(c => c.storeId === storeId) : this.storeHourCapsList;
  }
  async upsertStoreHourCap(data: InsertStoreHourCap): Promise<StoreHourCap> {
    const existing = this.storeHourCapsList.find(c => c.storeId === data.storeId && c.season === data.season);
    if (existing) {
      Object.assign(existing, data, { updatedAt: new Date() });
      return existing;
    }
    const row = { id: randomUUID(), ...data, updatedAt: new Date() } as StoreHourCap;
    this.storeHourCapsList.push(row);
    return row;
  }
```

- [ ] **Step 5: Verify no new type errors + build**

Run: `npx tsc --noEmit 2>&1 | grep "storeHourCaps\|getStoreHourCaps\|upsertStoreHourCap" || echo CLEAN` (expect CLEAN), then `npm run build 2>&1 | tail -3` (expect Done).

- [ ] **Step 6: Commit**

```bash
git add server/storage.ts
git commit -m "Roster caps: storage methods for store_hour_caps

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Server `getWeekCaps()` + `GET /api/rosters/week-caps`

**Files:**
- Modify: `server/routes.ts` — add import (line 8) and the helper + endpoint near the roster routes block (~line 982-1130).

- [ ] **Step 1: Extend the payrollCycle/rosterCaps imports at top of `server/routes.ts`**

Add a new import line near line 8:
```typescript
import { classifyWeekSeason, resolveWeekCaps, sumByCategory, findBreaches, type Season, type ResolvedWeekCaps } from "../shared/rosterCaps";
```

- [ ] **Step 2: Add the `getWeekCaps` helper + GET endpoint** (inside `registerRoutes`,
just BEFORE `app.get("/api/rosters/employees"` at ~line 982, so it's registered before
`/api/rosters/:id`-style routes; `week-caps` is a literal segment so it won't be shadowed)

```typescript
  // ── Season-based roster hour caps ──────────────────────────────────────────
  // Single source of truth: used by the builder display AND publish validation.
  async function getWeekCaps(storeId: string, weekStart: string): Promise<{
    season: Season; caps: ResolvedWeekCaps; configMissing: boolean;
  }> {
    const [holidays, caps, publicHols] = await Promise.all([
      storage.getSchoolHolidays(),
      storage.getStoreHourCaps(storeId),
      storage.getPublicHolidays(),
    ]);
    const season = classifyWeekSeason(weekStart, holidays.map(h => ({ startDate: h.startDate, endDate: h.endDate })));
    const cfgRow = caps.find(c => c.season === season);
    const config = {
      weeklyTotalHours: cfgRow?.weeklyTotalHours ?? 0,
      saturdayHours: cfgRow?.saturdayHours ?? 0,
      sundayHours: cfgRow?.sundayHours ?? 0,
      publicHolidayHours: cfgRow?.publicHolidayHours ?? 0,
    };
    // PH dates within the Mon..Sun week, where this store is NOT closed.
    const weekEnd = shiftDate(weekStart, 6);
    const phDays = publicHols
      .filter(p => p.date >= weekStart && p.date <= weekEnd)
      .filter(p => {
        const closures = (p.storeClosures ?? {}) as Record<string, boolean>;
        return closures[storeId] !== true;
      })
      .map(p => p.date);
    return { season, caps: resolveWeekCaps(season, config, phDays), configMissing: !cfgRow };
  }

  app.get("/api/rosters/week-caps", async (req: Request, res: Response) => {
    try {
      const { storeId, weekStart } = req.query as Record<string, string>;
      if (!storeId || !weekStart) return res.status(400).json({ error: "storeId and weekStart are required" });
      const { season, caps, configMissing } = await getWeekCaps(storeId, weekStart);
      // Actual usage from the flat rosters table for this store+week.
      const rosters = await storage.getRosters({ storeId, startDate: weekStart, endDate: shiftDate(weekStart, 6) });
      const shifts = rosters.map(r => ({ date: r.date, hours: hoursBetween(r.startTime, r.endTime) }));
      const used = sumByCategory(shifts, caps.phDays);
      const breaches = findBreaches(caps, used);
      res.json({ season, caps, used, breaches, configMissing, weekStart });
    } catch (err) {
      console.error("Error computing week caps:", err);
      res.status(500).json({ error: "Failed to compute week caps" });
    }
  });
```

- [ ] **Step 3: Add the `hoursBetween` helper** (module scope in `server/routes.ts`, near
the top after imports — mirrors the client `calcHours`)

```typescript
function hoursBetween(start: string, end: string): number {
  const [sh, sm] = (start || "0:0").split(":").map(Number);
  const [eh, em] = (end || "0:0").split(":").map(Number);
  let mins = (eh * 60 + em) - (sh * 60 + sm);
  if (mins < 0) mins += 1440;
  return Math.round((mins / 60) * 100) / 100;
}
```

- [ ] **Step 4: Confirm `storage.getSchoolHolidays` / `getPublicHolidays` / `getRosters` signatures**

Run: `grep -n "getSchoolHolidays\|getPublicHolidays(\|getRosters(" server/storage.ts | head`
Expected: methods exist. `getRosters` accepts `{ storeId, startDate, endDate }`. If a name differs, adjust the calls in Step 2.

- [ ] **Step 5: Build + type-check**

Run: `npm run build 2>&1 | tail -3` (expect Done); `npx tsc --noEmit 2>&1 | grep "routes.ts" | grep -i "getWeekCaps\|week-caps\|hoursBetween\|rosterCaps" || echo CLEAN`.

- [ ] **Step 6: Commit**

```bash
git add server/routes.ts
git commit -m "Roster caps: getWeekCaps helper + GET /api/rosters/week-caps

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Hour-caps config endpoints (`GET`/`PUT /api/store-config/hour-caps`)

**Files:**
- Modify: `server/routes.ts` — near the existing `/api/store-config/recommended-hours` routes (~line 8819).

- [ ] **Step 1: Add the GET + PUT endpoints** (right after the existing
`PUT /api/store-config/recommended-hours` handler)

```typescript
  app.get("/api/store-config/hour-caps", async (_req: Request, res: Response) => {
    try {
      res.json(await storage.getStoreHourCaps());
    } catch (err) {
      console.error("Error fetching hour caps:", err);
      res.status(500).json({ error: "Failed to fetch hour caps" });
    }
  });

  app.put("/api/store-config/hour-caps", async (req: Request, res: Response) => {
    try {
      const { storeId, season, weeklyTotalHours, saturdayHours, sundayHours, publicHolidayHours } = req.body as Record<string, any>;
      if (!storeId || (season !== "TERM" && season !== "HOLIDAY")) {
        return res.status(400).json({ error: "storeId and season ('TERM'|'HOLIDAY') are required" });
      }
      const wk = Number(weeklyTotalHours) || 0;
      const sat = Number(saturdayHours) || 0;
      const sun = Number(sundayHours) || 0;
      const ph = Number(publicHolidayHours) || 0;
      // A week may contain at most one PH most weeks; require the fixed allocations
      // (sat + sun + one PH) to fit within the weekly total so the weekday pool stays >= 0.
      if (sat + sun + ph > wk) {
        return res.status(400).json({ error: "saturday + sunday + publicHoliday must not exceed weeklyTotal" });
      }
      const row = await storage.upsertStoreHourCap({
        storeId, season, weeklyTotalHours: wk, saturdayHours: sat, sundayHours: sun, publicHolidayHours: ph,
      });
      res.json(row);
    } catch (err) {
      console.error("Error saving hour cap:", err);
      res.status(500).json({ error: "Failed to save hour cap" });
    }
  });
```

- [ ] **Step 2: Build + smoke-test the validation logic**

Run: `npm run build 2>&1 | tail -3` (expect Done).

- [ ] **Step 3: Commit**

```bash
git add server/routes.ts
git commit -m "Roster caps: GET/PUT /api/store-config/hour-caps

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: `POST /api/store-config/school-holidays/load-nsw`

**Files:**
- Modify: `server/routes.ts` — near the existing `/api/store-config/school-holidays` routes (~line 8745). Register the literal `/load-nsw` route BEFORE the `PUT /:id` / `DELETE /:id` routes.

- [ ] **Step 1: Import the NSW dataset** (top of `server/routes.ts`)

```typescript
import { NSW_SCHOOL_HOLIDAYS } from "../shared/nswSchoolHolidays";
```

- [ ] **Step 2: Add the endpoint** (immediately after the `GET /api/store-config/school-holidays` handler, before any `:id` routes)

```typescript
  // Bulk-load the bundled NSW school-holiday periods (idempotent: skips any period
  // whose name already exists). Admin only.
  app.post("/api/store-config/school-holidays/load-nsw", async (req: Request, res: Response) => {
    try {
      if ((req.user?.role ?? "").toUpperCase() !== "ADMIN") {
        return res.status(403).json({ error: "FORBIDDEN", message: "Director (ADMIN) only" });
      }
      const existing = await storage.getSchoolHolidays();
      const existingNames = new Set(existing.map(h => h.name));
      let added = 0;
      for (const p of NSW_SCHOOL_HOLIDAYS) {
        if (existingNames.has(p.name)) continue;
        await storage.createSchoolHoliday({ name: p.name, startDate: p.startDate, endDate: p.endDate });
        added++;
      }
      res.json({ added });
    } catch (err) {
      console.error("Error loading NSW holidays:", err);
      res.status(500).json({ error: "Failed to load NSW holidays" });
    }
  });
```

- [ ] **Step 3: Confirm `storage.createSchoolHoliday` signature**

Run: `grep -n "createSchoolHoliday" server/storage.ts | head`
Expected: a method taking `{ name, startDate, endDate }`. If the field names differ, adjust the call.

- [ ] **Step 4: Build**

Run: `npm run build 2>&1 | tail -3` (expect Done).

- [ ] **Step 5: Commit**

```bash
git add server/routes.ts
git commit -m "Roster caps: POST load-nsw school holidays (bundled dataset)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: Enforce caps at Publish (server)

**Files:**
- Modify: `server/routes.ts` — the existing `POST /api/rosters/publish` handler (~line 1119).

- [ ] **Step 1: Read the current publish handler**

Run: `sed -n '1119,1160p' server/routes.ts`
Expected: it reads `{ storeId, weekStart }` (or similar) and calls `storage.toggleRosterWeekPublished`. Note the exact body field names.

- [ ] **Step 2: Insert cap validation at the top of the handler** (after the body is read,
before publishing). Use the field names confirmed in Step 1 (assumed `storeId`, `weekStart`).

```typescript
      // Enforce season hour caps before publishing (ADMIN bypasses — Director override).
      if ((req.user?.role ?? "").toUpperCase() !== "ADMIN") {
        const { caps } = await getWeekCaps(storeId, weekStart);
        const rosters = await storage.getRosters({ storeId, startDate: weekStart, endDate: shiftDate(weekStart, 6) });
        const used = sumByCategory(
          rosters.map(r => ({ date: r.date, hours: hoursBetween(r.startTime, r.endTime) })),
          caps.phDays,
        );
        const breaches = findBreaches(caps, used);
        if (breaches.length > 0) {
          return res.status(403).json({
            error: "CAP_EXCEEDED",
            message: "이 주의 로스터가 근무시간 상한을 초과해 발행할 수 없습니다.",
            breaches,
          });
        }
      }
```

- [ ] **Step 3: Build + type-check**

Run: `npm run build 2>&1 | tail -3` (expect Done); `npx tsc --noEmit 2>&1 | grep "routes.ts" | grep -i "CAP_EXCEEDED\|getWeekCaps" || echo CLEAN`.

- [ ] **Step 4: Commit**

```bash
git add server/routes.ts
git commit -m "Roster caps: block publish when a week exceeds its hour caps

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: Store Settings — "Recommended Hours" tab → "Hour Caps"

**Files:**
- Modify: `client/src/pages/admin/StoreConfig.tsx` — `RecommendedHoursSection` (~lines 654-774), tab trigger label (~813-817).

- [ ] **Step 1: Read the current section + tab**

Run: `sed -n '654,774p' client/src/pages/admin/StoreConfig.tsx` and `sed -n '813,830p' client/src/pages/admin/StoreConfig.tsx`
Note the component shape (per-store cards, `isRosterStore` filter, the per-store save mutation, query key `/api/store-config/recommended-hours`).

- [ ] **Step 2: Replace the data layer to use hour-caps.** In `RecommendedHoursSection`,
change the query + mutation to the new endpoints. Query:

```typescript
  const { data: caps = [] } = useQuery<any[]>({ queryKey: ["/api/store-config/hour-caps"] });
  const capFor = (storeId: string, season: "TERM" | "HOLIDAY") =>
    caps.find(c => c.storeId === storeId && c.season === season) ?? { weeklyTotalHours: 38, saturdayHours: 0, sundayHours: 0, publicHolidayHours: 0 };
  const saveMutation = useMutation({
    mutationFn: (body: any) => apiRequest("PUT", "/api/store-config/hour-caps", body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/store-config/hour-caps"] });
      toast({ title: "상한 저장됨" });
    },
    onError: (e: any) => toast({ title: "저장 실패", description: e?.message ?? "", variant: "destructive" }),
  });
```

- [ ] **Step 3: Render, per roster store, two season blocks (Term / Holiday), each with 4
inputs (weekly total / Saturday / Sunday / public holiday-per-day) and a Save.** Replace
the two existing number inputs with this per-season editor (use local form state keyed by
`${storeId}:${season}`). Minimal structure:

```tsx
{(["TERM", "HOLIDAY"] as const).map(season => {
  const c = capFor(store.id, season);
  const key = `${store.id}:${season}`;
  const f = form[key] ?? c;
  const set = (field: string, v: number) => setForm(p => ({ ...p, [key]: { ...(p[key] ?? c), [field]: v } }));
  const overflow = (f.saturdayHours + f.sundayHours + f.publicHolidayHours) > f.weeklyTotalHours;
  return (
    <div key={season} className="space-y-2 border-t pt-3">
      <p className="text-sm font-medium">{season === "TERM" ? "학기 중 (Term)" : "방학 중 (Holiday)"}</p>
      <div className="grid grid-cols-2 gap-2">
        <LabeledNum label="주 합계" value={f.weeklyTotalHours} onChange={v => set("weeklyTotalHours", v)} />
        <LabeledNum label="토요일" value={f.saturdayHours} onChange={v => set("saturdayHours", v)} />
        <LabeledNum label="일요일" value={f.sundayHours} onChange={v => set("sundayHours", v)} />
        <LabeledNum label="공휴일(1일당)" value={f.publicHolidayHours} onChange={v => set("publicHolidayHours", v)} />
      </div>
      <p className="text-xs text-muted-foreground">주중 풀 = {Math.max(0, f.weeklyTotalHours - f.saturdayHours - f.sundayHours - f.publicHolidayHours)}h (공휴일 1일 가정)</p>
      {overflow && <p className="text-xs text-red-600">토+일+공휴일이 주 합계를 초과합니다.</p>}
      <Button size="sm" disabled={overflow || saveMutation.isPending}
        onClick={() => saveMutation.mutate({ storeId: store.id, season, weeklyTotalHours: f.weeklyTotalHours, saturdayHours: f.saturdayHours, sundayHours: f.sundayHours, publicHolidayHours: f.publicHolidayHours })}>
        저장
      </Button>
    </div>
  );
})}
```

Add the local form state near the top of the component: `const [form, setForm] = useState<Record<string, any>>({});`
Add a small `LabeledNum` helper component in the same file:

```tsx
function LabeledNum({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      <Input type="number" min="0" step="0.5" value={value}
        onChange={e => onChange(parseFloat(e.target.value) || 0)} className="text-sm" />
    </div>
  );
}
```

- [ ] **Step 4: Update tab label + helper text.** Change the tab trigger text and the
section helper from "Recommended Hours / 참고 기준" to "Hour Caps / 근무시간 상한 (강제)".
Find with `grep -n "Recommended Hours\|참고 기준\|recommended-hours" client/src/pages/admin/StoreConfig.tsx` and update the visible strings (keep the tab `value` id stable to avoid breaking tab state, or rename consistently).

- [ ] **Step 5: Build + type-check**

Run: `npm run build 2>&1 | tail -3` (expect Done); `npx tsc --noEmit 2>&1 | grep "StoreConfig.tsx" || echo CLEAN`.

- [ ] **Step 6: Commit**

```bash
git add client/src/pages/admin/StoreConfig.tsx
git commit -m "Roster caps: Hour Caps settings tab (term/holiday x day categories)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 10: Store Settings — "Load NSW holidays" button + VIC→NSW label

**Files:**
- Modify: `client/src/pages/admin/StoreConfig.tsx` — `SchoolHolidaysSection` (~234-419), header (~310-319).

- [ ] **Step 1: Fix the helper label** (line ~314)

Change `호주 빅토리아주 기준, 연 4회` → `NSW 기준, 연 4회`.

- [ ] **Step 2: Add the "Load NSW holidays" button + mutation** next to the existing
"Add Holiday Period" button (header row ~316).

```tsx
  const loadNsw = useMutation({
    mutationFn: () => apiRequest("POST", "/api/store-config/school-holidays/load-nsw"),
    onSuccess: async (r: any) => {
      const data = await r.json();
      queryClient.invalidateQueries({ queryKey: ["/api/store-config/school-holidays"] });
      toast({ title: `NSW 방학 ${data.added}건 불러옴` });
    },
    onError: (e: any) => toast({ title: "불러오기 실패", description: e?.message ?? "", variant: "destructive" }),
  });
```

```tsx
  <Button size="sm" variant="outline" onClick={() => loadNsw.mutate()} disabled={loadNsw.isPending} data-testid="btn-load-nsw-holidays">
    {loadNsw.isPending ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Download className="w-4 h-4 mr-1" />}
    Load NSW holidays
  </Button>
```

(Import `Download` and `Loader2` from `lucide-react` if not already imported; confirm `queryClient`/`toast`/`apiRequest`/`useMutation` are in scope — they are used elsewhere in this file.)

- [ ] **Step 3: Build + type-check**

Run: `npm run build 2>&1 | tail -3` (expect Done); `npx tsc --noEmit 2>&1 | grep "StoreConfig.tsx" || echo CLEAN`.

- [ ] **Step 4: Commit**

```bash
git add client/src/pages/admin/StoreConfig.tsx
git commit -m "Roster caps: Load NSW holidays button + NSW label fix

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 11: Roster builder — season badge + usage/cap + Publish gate

**Files:**
- Modify: `client/src/pages/admin/Rosters.tsx` — main `AdminRosters` (~793), header area, Publish button.

- [ ] **Step 1: Add the week-caps query** (near other queries in `AdminRosters`, after `weekStart`/`selectedStoreId` are defined)

```typescript
  const { data: weekCaps } = useQuery<{
    season: "TERM" | "HOLIDAY";
    caps: { weeklyTotal: number; saturdayCap: number; sundayCap: number; publicHolidayCap: number; weekdayPool: number; phDays: string[] };
    used: { SATURDAY: number; SUNDAY: number; PUBLIC_HOLIDAY: number; WEEKDAY: number };
    breaches: { category: string; used: number; cap: number }[];
    configMissing: boolean;
  }>({
    queryKey: ["/api/rosters/week-caps", selectedStoreId, weekStart],
    queryFn: () => fetch(`/api/rosters/week-caps?storeId=${selectedStoreId}&weekStart=${weekStart}`).then(r => r.json()),
    enabled: !!selectedStoreId && !!weekStart,
  });
  const overCap = (weekCaps?.breaches?.length ?? 0) > 0;
```

- [ ] **Step 2: Render the season + usage/cap banner** (in the header, near the existing
`totalStoreHours` display). Show each category `used/cap`, red when used>cap.

```tsx
{weekCaps && (
  <div className="flex flex-wrap items-center gap-3 text-xs rounded-lg border border-border/40 bg-card px-3 py-2" data-testid="roster-caps-banner">
    <span className="font-semibold">{weekCaps.season === "HOLIDAY" ? "방학" : "학기중"}</span>
    {weekCaps.configMissing && <span className="text-amber-600">상한 미설정 — Store Settings에서 지정</span>}
    {(() => {
      const c = weekCaps.caps, u = weekCaps.used;
      const total = Math.round((u.SATURDAY + u.SUNDAY + u.PUBLIC_HOLIDAY + u.WEEKDAY) * 100) / 100;
      const cell = (label: string, used: number, cap: number) => (
        <span className={used > cap ? "text-red-600 font-medium" : "text-muted-foreground"}>
          {label} {used}/{cap}
        </span>
      );
      return (<>
        {cell("주", total, c.weeklyTotal)}
        {cell("토", u.SATURDAY, c.saturdayCap)}
        {cell("일", u.SUNDAY, c.sundayCap)}
        {cell("공휴일", u.PUBLIC_HOLIDAY, c.publicHolidayCap)}
        {cell("주중", u.WEEKDAY, c.weekdayPool)}
      </>);
    })()}
  </div>
)}
```

- [ ] **Step 3: Gate the Publish button.** Find it with
`grep -n "publish\|Publish" client/src/pages/admin/Rosters.tsx`. Add `|| overCap` to its
`disabled` prop and a tooltip/title:

```tsx
  disabled={/* existing conditions */ || overCap}
  title={overCap ? "근무시간 상한 초과 — 발행 불가" : undefined}
```

Also handle the publish mutation's 403 `CAP_EXCEEDED` in its `onError` by showing the
returned `message` in a toast (the server is the final guard).

- [ ] **Step 4: Build + type-check**

Run: `npm run build 2>&1 | tail -3` (expect Done); `npx tsc --noEmit 2>&1 | grep "Rosters.tsx" || echo CLEAN`.

- [ ] **Step 5: Commit**

```bash
git add client/src/pages/admin/Rosters.tsx
git commit -m "Roster caps: builder season badge, usage/cap display, publish gate

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 12: Docs + final verification

**Files:**
- Modify: `plan.md`

- [ ] **Step 1: Add a dated note to `plan.md`** summarizing the feature (table, getWeekCaps,
publish enforcement, NSW loader, settings tab, builder display) and that Phase 2
(sales-based recommendation) is pending. Reference the spec path.

- [ ] **Step 2: Full build + run the pure-logic verifier**

Run: `npm run build 2>&1 | tail -3` (expect Done) and `npx tsx script/verify-roster-caps.ts` (expect OK).

- [ ] **Step 3: Commit**

```bash
git add plan.md
git commit -m "Roster caps: PLAN.md note

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 4: Post-deploy manual checklist** (after the user deploys — only prod DB exists)

  - Boot log shows `store_hour_caps` created + seed rows (one TERM + one HOLIDAY per roster store).
  - Store Settings → Hour Caps: set Term {weekly 38, Sat 8, Sun 6, PH 5} for Sushi; Save persists.
  - Store Settings → School Holidays → "Load NSW holidays" → toast shows count; rows appear; second click adds 0 (idempotent).
  - Roster builder, a TERM week: banner shows "학기중" + `주 x/38 · 토 y/8 …`. Schedule over 8h on Saturday → 토 turns red; Publish disabled.
  - A week inside an NSW holiday range → banner shows "방학" automatically.
  - As ADMIN, publishing an over-cap week is allowed (Director bypass); as MANAGER it is blocked with the CAP_EXCEEDED toast.

---

## Self-Review notes

- **Spec coverage:** store-total caps (Tasks 3-6,11), block-at-publish (Task 8 + 11 gate), auto season detection (Task 1 `classifyWeekSeason` + Task 5), NSW load button + manual edit (Tasks 7,10), VIC→NSW label (Task 10), day categories incl. PH precedence (Task 1 `dayCategory`), weekday pool fixed (Task 1 `resolveWeekCaps`), config validation (Task 6), straddle majority rule (Task 1 + verifier). Phase 2 explicitly deferred.
- **Type consistency:** `getWeekCaps` returns `{ season, caps: ResolvedWeekCaps, configMissing }`; `ResolvedWeekCaps` fields (`weeklyTotal`, `saturdayCap`, `sundayCap`, `publicHolidayCap`, `weekdayPool`, `phDays`) are used identically in routes (Tasks 5,8) and client (Task 11). `sumByCategory`/`findBreaches` signatures match between server and the pure module.
- **External data:** NSW dates are fetched from the official source in Task 2 (not fabricated); a grep guard fails the task if `__` placeholders remain.
