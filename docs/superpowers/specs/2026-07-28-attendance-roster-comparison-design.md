# Attendance History — Store Filter + Roster-vs-Actual Grid & Timeline Views — Design

Date: 2026-07-28
Status: Approved for implementation

## Problem & Goal

`Attendance History` (`client/src/pages/admin/Timesheets.tsx`) currently lists approved
work records as a flat per-employee table of **actual** hours. It has `SCHEDULED` and
`DIFF` columns, but they render `—` for every row, always.

The owner wants to answer one question at a glance:

> "로스터는 이랬는데, 실제 타임시트는 이렇다."

Two additions:

1. **Store filter buttons** (All / Sushi / Sandwich) on the page.
2. **Grid View and Timeline View**, ported from the Rosters page, showing the roster
   schedule *behind* the actual attendance — roster faint, actual bold — so a manager
   can see whether the fortnight was worked as planned.

## Root-cause finding (drives the design)

The `SCHEDULED` / `DIFF` columns are not empty because data is missing. They are wired
to the wrong table.

`GET /api/admin/approvals` (`server/routes.ts:5747`) enriches each timesheet with a
scheduled shift looked up from `storage.getShifts()` — the legacy `shifts` table
(`shared/schema.ts:207`, FK-bound to `rosterPeriods`). The Roster Builder writes to
the `rosters` table (`shared/schema.ts:231`). They are different tables.

Verified against production (Railway Postgres, 2026-07-28):

| Table | Rows |
|---|---|
| `shifts` — what approvals joins against | **0** |
| `rosters` — what Roster Builder writes | 2,828 |
| `shift_timesheets` | 2,910 |

Current cycle (2026-07-13 → 2026-07-26): rosters Sushi 40 / Sandwich 46; timesheets
Sushi 39 / Sandwich 48. Roster date span: 2025-04-14 → 2026-08-02.

So the comparison data already exists and is dense. Nothing needs to be back-filled.

### Consequence: the endpoint fix alone is not enough

`/api/admin/approvals` returns **one row per timesheet**. A roster entry with no
timesheet at all — the rostered-but-never-worked shift — produces no row. That is the
single most valuable cell in a roster-vs-actual comparison, and it can never come from
this endpoint.

Therefore the client fetches `/api/rosters` for the cycle **regardless** of the server
fix. `storage.getRosters()` (`server/storage.ts:3612`) treats `storeId` as optional, so
one unfiltered query per cycle covers both stores; store filtering happens client-side
so the filter buttons stay instant.

## Confirmed decisions

| Decision | Choice |
|---|---|
| Scope of change | **Add**, not replace. The existing List view stays as the default view. |
| Grid layout for a 14-day cycle | **Two stacked 7-column tables** (Week 1 / Week 2), matching the Week 1 / Week 2 split the existing HistoryModal already uses. |
| Server `shifts` → `rosters` join fix | **Include it.** One line at `server/routes.ts:5747`. Accepted side effect: the Pending Approvals screen's `Scheduled` / `Diff` columns start showing values. |
| Timeline + "All" store filter | **Require a specific store.** Selecting Timeline while the filter is `All` auto-switches the filter to Sushi, matching Rosters page behaviour. |
| New API endpoints | **None.** `/api/rosters`, `/api/stores`, `/api/employees` already serve what is needed. |
| Grid editability | **Read-only.** Approved records are edited only via the existing "Revert to Pending" flow. |

## Data sources

| Source | Purpose | Notes |
|---|---|---|
| `GET /api/admin/approvals?status=ALL` | Actual attendance | Existing query, unchanged. Filtered client-side to `status === "APPROVED"` and to the cycle date range. |
| `GET /api/rosters?startDate=<cycleStart>&endDate=<cycleEnd>` | **New call.** Roster schedule for the cycle, both stores | Query key `["/api/rosters", "cycle", cycleStart]`. No `storeId` param. |
| `GET /api/stores` | **New call.** Store filter buttons + Timeline open/close axis | Roster stores = `active && !isExternal`, ordered Sushi then Sandwich (same rule as `Rosters.tsx:827`). |
| `GET /api/employees` | **New call.** Names for roster-only employees | `/api/admin/approvals` carries `employeeName`/`employeeNickname`, but only for employees who have a timesheet. A roster-only employee has no row there. |
| `GET /api/payrolls?period_start=` | PAID lock badges | Existing query, unchanged. |

## Merge model

New pure module: `client/src/components/attendance/attendanceModel.ts`.

### Cell key

`${employeeId}|${date}|${storeId}`.

**Store is part of the key.** Production data confirms an employee can be rostered at
both stores on the same day — e.g. employee `9af4c4d1-1c47-4edb-becc-7ed37b5742a4`
(Angy) on 2026-07-13 and 2026-07-20, inside the current cycle. Ten such
employee+date pairs exist in `shift_timesheets` since 2026-01-01. A grid cell
therefore holds an **array** of entries (usually length 1, occasionally 2), rendered
stacked.

### Types

```ts
type CellStatus = "MATCH" | "DIFF" | "NO_SHOW" | "UNSCHEDULED";

interface AttendanceEntry {
  employeeId: string;
  date: string;                     // YYYY-MM-DD
  storeId: string;
  storeName: string;
  roster: { start: string; end: string; hours: number } | null;
  actual: { id: string; start: string; end: string; hours: number; isUnscheduled: boolean } | null;
  diffMinutes: number;              // actual - roster, 0 when either side is null
  status: CellStatus;
}

interface AttendanceRow {
  employeeId: string;
  displayName: string;              // nickname ?? firstName
  fullName: string;
  cells: Map<string, AttendanceEntry[]>;   // key: date
  rosterHours: number;
  actualHours: number;
  diffMinutes: number;
  storeNames: string[];
}
```

### Status derivation

| roster | actual | diff | status |
|---|---|---|---|
| present | present | 0 | `MATCH` |
| present | present | ≠ 0 | `DIFF` |
| present | absent | — | `NO_SHOW` |
| absent | present | — | `UNSCHEDULED` |

`UNSCHEDULED` is derived from the merge (no matching roster), not from the
`shiftTimesheets.isUnscheduled` column — that column is set at creation time and can
disagree with the roster as it stands now. The column is still surfaced as a secondary
tag where it is set.

### Row axis is a union

Rows = employees with **a roster in the cycle** ∪ employees with **an approved
timesheet in the cycle**, after the store filter. Keying rows off timesheets alone
would hide an employee rostered all fortnight who never clocked in — the row a manager
most needs to see. Sorted by `displayName.localeCompare`, matching the existing
`groupByEmployee` sort.

### Store filter applies at entry level

Filter the timesheet list and the roster list **before** grouping, not after. Angy has
both Sushi and Sandwich rows; filtering at group level would show her under "Sushi"
with Sandwich hours folded into her totals. The three summary stat cards recompute
from the filtered set.

## Page layout

```
Attendance History
Approved work records — by fortnight cycle

[◀]        13 July 2026 – 26 July 2026        [▶] [Current]

[ All ][ Sushi ][ Sandwich ]              [ List ][ Grid ][ Timeline ]

[ Employees  14 ] [ Total Hours  625h 15m ] [ Payroll Paid  0 ]
                    Roster 618h · +7h 15m
```

- Store buttons reuse the Rosters brand-colour button pattern (`Rosters.tsx:1092-1111`,
  `STORE_COLORS` from `@shared/storeColors`). `All` is retained — the page shows all
  stores today and removing that is a regression.
- View toggle reuses the Rosters segmented-control pattern (`Rosters.tsx:1168-1196`),
  extended to three segments.
- The `Total Hours` card gains a second line — `Roster {h} · {±diff}` — so the roster
  comparison is visible even in the List view. Computed from the client-side roster
  map, not from `ts.scheduledStartTime`.
- Default view is `List`. View mode and store filter are component state only; not
  persisted across navigation.

## Grid View

`client/src/components/attendance/AttendanceGridView.tsx`

Two stacked tables, Week 1 (`cycleStart` … `cycleStart+6`) and Week 2
(`cycleStart+7` … `cycleEnd`). Columns: Employee | 7 days | Roster | Actual | Diff.

Each cell renders its entries stacked. A single entry:

```
09:00–17:00     ← roster line: muted/40 foreground, normal weight
09:00–17:30     ← actual line: foreground, semibold
        +30m    ← diff badge, only when status === "DIFF"
```

Per-status treatment:

| Status | Treatment |
|---|---|
| `MATCH` | Both lines. No badge. |
| `DIFF` | Both lines + diff badge. Orange when actual > roster, blue when under — reusing the existing `DiffCell` colour convention (`Timesheets.tsx:155-165`). |
| `NO_SHOW` | Roster line only, in a **dashed-border** cell with a muted `no record` label. Visually distinct from an empty (never-rostered) cell. |
| `UNSCHEDULED` | Actual line only + purple `Unsched` tag, reusing the existing convention at `Timesheets.tsx:313-315`. |
| No roster, no actual | `—`, muted. |

When a cell holds two entries (dual-store day), each entry is prefixed with its store
colour dot (`storeColorFor`), matching how the page already marks stores.

**Read-only.** The Rosters `CellEditor` component is the write path — it carries
`upsertMutation` / `deleteMutation` and a time-picker popover. It is **not** reused.
A new presentational cell component is written instead.

**Mobile:** the fortnight grid does not fit a phone. Mobile Grid renders the Rosters
day-ribbon pattern (`Rosters.tsx:1229-1261`): a **`[Week 1] [Week 2]` toggle** above a
**7-day ribbon**, then a per-day card list showing roster vs actual per employee.
Fourteen day tabs in one row would be unreadable on a phone, hence the week toggle.

## Timeline View

`client/src/components/attendance/AttendanceTimelineView.tsx`

Forked from `DailyTimeline` (`Rosters.tsx:556-790`), which is already read-only and so
ports cleanly. Structure retained: day-selector tabs, coverage stats bar, vertical
time axis from store `openTime` to `closeTime`, one column per working employee.

**Colour system is replaced.** Rosters cycles 10 hues by employee index
(`TIMELINE_COLORS`, `Rosters.tsx:536-540`). That fights the faint-vs-bold contrast
which is the entire point of this view. Instead:

- **Roster** — pale neutral grey band, full column width. This is the "연한 회색"
  the request asks for literally.
- **Actual** — store brand colour (`STORE_COLORS`), solid, narrower, inset on top of
  the band.

Reading the result:

| What you see | Meaning |
|---|---|
| Solid bar fills the pale band | Worked as rostered |
| Solid bar shorter than the band | Left early / arrived late |
| Solid bar overflows the band | Overtime |
| Pale band, dashed outline, no solid bar | `NO_SHOW` |
| Solid bar with no band behind it | `UNSCHEDULED` |

Day selection uses the **same `[Week 1] [Week 2]` toggle + 7-day ribbon** as mobile
Grid, rather than 14 tabs in one row. Selected day defaults to the first day of the
cycle that has any entry; falls back to `cycleStart`. The selected day is shared state
between Grid (mobile) and Timeline, so switching views keeps the day.

Axis bounds come from the selected store's `openTime` / `closeTime`. Entries outside
those bounds (e.g. an actual clock-out after close) are clamped for positioning but
keep their true times in the label and tooltip.

**Store requirement:** clicking `Timeline` while the store filter is `All` sets the
filter to the first roster store (Sushi). Switching the filter back to `All` while in
Timeline view also switches the view back to `List`.

## Server change

`server/routes.ts:5747` — swap the scheduled-shift lookup source:

```ts
// before
storage.getShifts(),
const scheduledShift = allShifts.find(s => ... );

// after
storage.getRosters(),
const scheduledRoster = allRosters.find(r => ... );
```

The match predicate (`employeeId && storeId && date`) is unchanged and is already
correct for dual-store days.

Effects:
- `Attendance History` List view: `Scheduled` / `Diff` columns populate.
- `Pending Approvals` (`TimesheetApprovals.tsx`): its `Scheduled` / `Diff` columns and
  `totalScheduledHours` populate. This screen was not part of the request; the change
  is accepted deliberately as a fix to a dead display.

No other consumer reads `scheduledStartTime` / `scheduledEndTime`.

Note on load: the handler already fetches all timesheets (2,910), all employees and all
stores unfiltered. Adding all rosters (2,828) keeps the same performance profile.
Not optimised in this change.

## Files

| File | Change |
|---|---|
| `server/routes.ts` | `getShifts()` → `getRosters()` at the approvals enrichment (~line 5739-5760) |
| `client/src/pages/admin/Timesheets.tsx` | Shell: new queries, store filter, view toggle, stat-card roster line. List view retained. |
| `client/src/components/attendance/attendanceModel.ts` | **New.** Types + merge logic + shared date/time helpers. Pure, no React. |
| `client/src/components/attendance/AttendanceGridView.tsx` | **New.** |
| `client/src/components/attendance/AttendanceTimelineView.tsx` | **New.** |

`Timesheets.tsx` is 756 lines today; adding two views inline would push it past 1,200.
The page stays a shell.

## Pitfalls checked before implementation

- **Date off-by-one.** `Rosters.tsx` `fmtDate`/`fmtShortDate` use `new Date(dateStr)`
  (parsed as UTC); `Timesheets.tsx` uses `new Date(dateStr + "T00:00:00")` (local).
  Copying the Rosters helpers verbatim shifts dates by one day for Sydney users.
  **The Timesheets versions are canonical** and move into `attendanceModel.ts`.
  This is PLAN.md mandatory-checklist item 5.
- **Overnight shifts.** `Timesheets.tsx` `calcHours` adds 24h when the difference is
  negative (`Timesheets.tsx:95-100`); `Rosters.tsx` `calcHours` returns `0`
  (`Rosters.tsx:124-127`). The Timesheets version is canonical.
- **Timeline positioning helpers** (`topPx`, `heightPx`) use `toMins`, which is unaware
  of overnight wrap. An actual end time before its start is clamped to the axis close
  rather than wrapping to the next day. Accepted: the timeline is a single-day view.
- **Store colour for `Sushi` is `#222222`** (near-black). The pale roster band must be
  a neutral grey independent of store colour, or the Sushi band and bar would be
  indistinguishable in shade alone.
- **Dark mode.** Roster band and dashed outlines use theme tokens
  (`muted`, `border`) rather than hard-coded greys, so the faint/bold relationship
  survives dark mode. Store brand colours stay literal hex, as they do today.
- **Empty roster weeks.** Cycles before 2025-04-14 have no roster data; every cell
  becomes `UNSCHEDULED`. The Grid shows an inline notice — "No roster data for this
  cycle" — rather than implying a fortnight of unscheduled work.

## Verification

No test runner exists in this project (`package.json` scripts: `dev`, `build`,
`check`, `start`, `db:push`). Verification is:

1. `npm run check` — clean tsc.
2. Manual pass on the current cycle (2026-07-13 → 2026-07-26), which contains real
   roster and timesheet data for both stores:
   - Store filter All / Sushi / Sandwich changes stat cards and row counts.
   - Angy (dual-store, 2026-07-13 and 2026-07-20) shows two entries in one Grid cell,
     and her totals split correctly per store filter.
   - At least one `NO_SHOW` and one `UNSCHEDULED` cell render distinctly (counts
     differ per store: Sushi 40 rosters / 39 timesheets, Sandwich 46 / 48).
   - Timeline pale band vs solid bar reads correctly; `All` → Timeline auto-selects
     Sushi.
   - Pending Approvals now shows `Scheduled` / `Diff` values (server change).
3. PLAN.md mandatory post-task checklist, sections 3.x and 6. Section 4 needs no entry
   — no new endpoint is added.
