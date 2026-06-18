# Season-based Roster Hour Caps + NSW Holiday Auto-load — Design

Date: 2026-06-18
Status: Draft for review

## Problem & Goal

The "Recommended Hours" Store Settings tab stores per-store weekly hours (Term /
Holiday) but nothing reads them — they are advisory only. The owner wants these to be
**enforced caps**: per store, per season, a maximum total staff-hours the store may
roster in a week, broken down by day category, so managers build rosters **within**
the cap rather than freely.

Two phases:
- **Phase 1 (this spec):** manual cap configuration + automatic season detection +
  enforcement in the roster builder.
- **Phase 2 (later, out of scope here):** recommend the weekly cap from prior-week
  sales × target labour-cost % ÷ staff wages; feeds Phase 1's weekly total.

## Confirmed decisions

| Decision | Choice |
|---|---|
| Cap scope | **Store total staff-hours per week** (sum of all employees' rostered hours at that store), not per-employee. Matches existing per-store config and `totalStoreHours`. |
| Enforcement strength | **Block at Publish.** Drafts/edits are free (temporary over-cap allowed while arranging); a week over any cap cannot be Published. Over-cap categories shown red. Server re-validates on publish. |
| Season detection | **Automatic** from the School Holidays date ranges. No manual per-week toggle. |
| Region | **NSW** (business is Sydney / Australia/Sydney). Fix the existing "Victoria" label. |
| Holiday data entry | **Bundled NSW dataset + "Load NSW holidays" button** in the existing School Holidays tab; manual add/edit/delete remains for adjustments. |
| Day categories | Saturday, Sunday, Public Holiday (per PH day), Weekday-pool (remainder). Sat/Sun/PH = fixed caps; weekday pool = total − sat − sun − (phPerDay × #PH days that week). |

### Default rules (confirm during review)
- **Straddling week** (week partly term, partly break): classify by **majority of the
  7 days** — ≥4 days inside a school-holiday range ⇒ Holiday week; tie (or fewer) ⇒ Term.
- **Public-holiday precedence:** if a day is both a weekend day and a public holiday,
  the **PH cap** applies (highest labour cost), not the Sat/Sun cap.
- **Weekday pool is fixed** from the configured caps — unused Saturday/Sunday/PH hours
  do **not** roll over into weekdays.
- **Store-closed days:** a day where the store doesn't trade (`storeTradingHours.isClosed`)
  or a PH where `publicHolidays.storeClosures[storeId] === true` contributes 0 to caps
  and should not be rostered.

## Data model

### New table `store_hour_caps`
One row per (store, season). Seeded from existing `storeRecommendedHours.weeklyTotal`.
```
id            varchar pk
store_id      varchar fk -> stores(id)
season        text     -- 'TERM' | 'HOLIDAY'
weekly_total_hours       real
saturday_hours           real
sunday_hours             real
public_holiday_hours     real   -- per PH day
updated_at    timestamp
UNIQUE(store_id, season)
```
Validation on save: `saturday + sunday + public_holiday <= weekly_total` (so the weekday
pool can't go negative for a week with at most one PH; multi-PH weeks are validated at
compute time and surface as a config warning).

`storeRecommendedHours` is left intact (no destructive drop); its term/holiday weekly
values seed `weekly_total_hours` on migration. The Settings tab switches to editing
`store_hour_caps`.

### School holidays (existing `schoolHolidays`, unchanged shape)
Global table of `{name, startDate, endDate}`. Holiday (break) periods only; any week not
majority-inside a range is Term. NSW breaks (~4/year) are loaded via the new button.

### NSW preset dataset (new constant)
`shared/nswSchoolHolidays.ts` — official NSW break periods for the supported years
(current + next 1–2), each `{name, startDate, endDate}`. Populated from the official
NSW Department of Education source at implementation (NOT from memory). The loader
inserts these into `schoolHolidays`, skipping any (name or overlapping range) already
present (idempotent). New years added to the constant over time.

## Server: single source of truth `getWeekCaps(storeId, weekStart)`

Pure-ish server function (fetches store config, school holidays, public holidays, trading
hours) returning everything the UI and the publish check need:
```
{
  season: 'TERM' | 'HOLIDAY',
  weeklyTotal, saturdayCap, sundayCap, publicHolidayCap,
  phDays: ['YYYY-MM-DD', ...],     // PH dates in the week the store is open
  weekdayPool,                      // total - sat - sun - phCap*phDays.length
  caps: { saturday, sunday, weekday, publicHoliday, weekly } // resolved numbers
}
```
- Season = majority-of-days vs `schoolHolidays`.
- `phDays` = `publicHolidays` in [weekStart..weekStart+6] excluding store closures.
- Used by BOTH the display endpoint and the publish validation → no client/server drift.

Endpoints:
- `GET /api/rosters/week-caps?storeId=&weekStart=` → the object above (for builder display).
- `POST /api/store-config/school-holidays/load-nsw` (ADMIN) → inserts bundled NSW periods
  (idempotent), returns count added.
- Publish (`POST /api/rosters/publish`) gains server-side validation: recompute caps +
  actual category sums for the week; if any category exceeds its cap, return 403
  `CAP_EXCEEDED` with the offending breakdown.

## Frontend

### Store Settings — "Recommended Hours" tab → "근무시간 상한 (Hour Caps)"
Per roster store (Sushi/Sandwich), per season (Term/Holiday): inputs for weekly total,
Saturday, Sunday, public-holiday-per-day. Helper text changes "참고 기준" → enforced cap.
Save validates sat+sun+ph ≤ total.

### Store Settings — School Holidays tab
Add **"Load NSW holidays"** button next to "Add Holiday Period"; calls the load-nsw
endpoint, toasts count added. Fix helper label "빅토리아주" → "NSW". Existing
add/edit/delete unchanged.

### Roster builder (`Rosters.tsx`)
- Fetch `week-caps` for the selected store+week.
- Header shows season badge + per-category usage vs cap, e.g.
  `주 36/38h · 토 6/8 · 일 4/6 · 공휴일 0/0 · 주중 26/24 ⚠`. Over-cap categories red.
- Category actuals computed from rostered shifts grouped by day category (reuse
  `calcHours` / day sums already present).
- **Publish button disabled** (with reason tooltip) while any category is over cap.
  Server still re-validates on publish (defense in depth, mirrors the approval-lock pattern).

## Phase 2 (outline only — not built now)
A compute step: prior-week `dailySales` per store × target labour % ÷ blended wage
(`employeeStoreAssignments.rate`) → suggested `weekly_total_hours`. Surfaced as a
suggestion the owner can "apply" into the cap. The Phase 1 table + `getWeekCaps` are the
foundation; no schema change expected beyond possibly storing a per-week override.

## Edge cases
- Multi-PH week: weekday pool shrinks by phCap × count; if it goes negative, surface a
  config warning (caps mis-set) rather than silently clamping.
- Week with no PH: phDays empty, weekday pool = total − sat − sun.
- Store closed Sat/Sun: that cap is effectively 0; rostering there flags over-cap.
- Season badge + caps update automatically as the calendar crosses a school-holiday
  boundary (data-driven; no manual switch).

## Out of scope
- Per-employee caps / cross-store aggregation (the cap is store-total).
- Phase 2 recommendation engine.
- Connecting the flat `rosters` builder to the separate `shifts`/mobile model.
