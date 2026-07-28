// Grid View — roster schedule vs actual attendance, laid out as a calendar.
//
// The whole point is the visual pair inside each cell: the rostered time in faint
// grey, the actual worked time in solid dark directly beneath it. Scanning a column
// answers "did the day run as planned?" without reading a single number.
//
// Read-only. Rosters.tsx's CellEditor is deliberately NOT reused — it carries the
// upsert/delete mutations, and approved records are edited only via Revert to Pending.

import { AlertCircle, CalendarOff, TrendingDown, TrendingUp } from "lucide-react";
import {
  addDays,
  dayOfMonth,
  DAY_NAMES,
  fmtCycleDate,
  fmtDiffMinutes,
  fmtHours,
  hoursDiffMinutes,
  type AttendanceEntry,
  type AttendanceRow,
} from "./attendanceModel";

// ── Shared cell internals ────────────────────────────────────────────────────

function DiffBadge({ diffMinutes, compact }: { diffMinutes: number; compact?: boolean }) {
  if (diffMinutes === 0) return null;
  const isOver = diffMinutes > 0;
  const color = isOver
    ? "text-orange-600 dark:text-orange-400"
    : "text-blue-600 dark:text-blue-400";
  const Icon = isOver ? TrendingUp : TrendingDown;
  return (
    <span className={`inline-flex items-center gap-0.5 font-semibold ${color} ${compact ? "text-[9px]" : "text-[10px]"}`}>
      <Icon className="h-2.5 w-2.5" />
      {fmtDiffMinutes(diffMinutes)}
    </span>
  );
}

/** One roster/actual pair. Store dot only shows when the day spans two stores. */
function EntryBlock({ entry, showStore }: { entry: AttendanceEntry; showStore: boolean }) {
  const { roster, actual, status } = entry;

  return (
    <div
      className={`rounded px-1 py-0.5 ${
        status === "NO_SHOW"
          ? "border border-dashed border-muted-foreground/40 bg-muted/20"
          : ""
      }`}
      data-testid={`attendance-entry-${entry.employeeId}-${entry.date}-${entry.storeId}`}
      data-status={status}
      title={
        `${entry.storeName}\n` +
        `Roster: ${roster ? `${roster.start}–${roster.end}` : "none"}\n` +
        `Actual: ${actual ? `${actual.start}–${actual.end}` : "no record"}`
      }
    >
      {showStore && (
        <div className="flex items-center gap-1 mb-0.5">
          <span className="h-1.5 w-1.5 rounded-full shrink-0" style={{ backgroundColor: entry.storeColor }} />
          <span className="text-[9px] text-muted-foreground truncate">{entry.storeName}</span>
        </div>
      )}

      {/* Roster — faint */}
      {roster ? (
        <div className="text-[10px] leading-tight text-muted-foreground/70 tabular-nums">
          {roster.start}–{roster.end}
        </div>
      ) : (
        <div className="text-[10px] leading-tight text-muted-foreground/30 tabular-nums">
          no roster
        </div>
      )}

      {/* Actual — solid */}
      {actual ? (
        <div className="text-[11px] leading-tight font-semibold text-foreground tabular-nums">
          {actual.start}–{actual.end}
        </div>
      ) : (
        <div className="text-[10px] leading-tight italic text-muted-foreground/60">
          no record
        </div>
      )}

      <div className="flex items-center gap-1 flex-wrap">
        {status === "DIFF" && <DiffBadge diffMinutes={entry.diffMinutes} />}
        {status === "UNSCHEDULED" && (
          <span className="text-[9px] italic text-purple-600 dark:text-purple-400">Unsched</span>
        )}
      </div>
    </div>
  );
}

function DayCell({ entries }: { entries: AttendanceEntry[] }) {
  if (entries.length === 0) {
    return <span className="block text-center text-xs text-muted-foreground/30">—</span>;
  }
  return (
    <div className="space-y-0.5">
      {entries.map(e => (
        <EntryBlock key={e.storeId} entry={e} showStore={entries.length > 1} />
      ))}
    </div>
  );
}

// ── Week table (desktop) ─────────────────────────────────────────────────────

function WeekTable({
  label,
  weekStart,
  rows,
}: {
  label: string;
  weekStart: string;
  rows: AttendanceRow[];
}) {
  const dates = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));

  // Only rows with something in this week — a fortnight-long roster shouldn't force
  // an empty Week 2 row for someone who only worked Week 1.
  const weekRows = rows.filter(r => dates.some(d => (r.cells.get(d) ?? []).length > 0));

  // Diff comes from the hour totals, never from summing per-cell diffs — a NO_SHOW
  // cell has no per-cell diff, so summing would hide the missed hours entirely.
  const weekTotals = (row: AttendanceRow) => {
    const t = dates.reduce(
      (acc, d) => {
        (row.cells.get(d) ?? []).forEach(e => {
          acc.roster += e.roster?.hours ?? 0;
          acc.actual += e.actual?.hours ?? 0;
        });
        return acc;
      },
      { roster: 0, actual: 0 },
    );
    return { ...t, diff: hoursDiffMinutes(t.actual, t.roster) };
  };

  const dayTotals = (date: string) =>
    rows.reduce(
      (acc, r) => {
        (r.cells.get(date) ?? []).forEach(e => {
          acc.roster += e.roster?.hours ?? 0;
          acc.actual += e.actual?.hours ?? 0;
        });
        return acc;
      },
      { roster: 0, actual: 0 },
    );

  return (
    <div className="rounded-lg border border-border/40 overflow-hidden bg-card">
      <div className="bg-muted/40 px-3 py-1.5 flex items-baseline gap-2">
        <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">{label}</span>
        <span className="text-[10px] text-muted-foreground">
          {fmtCycleDate(weekStart)} – {fmtCycleDate(addDays(weekStart, 6))}
        </span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm border-collapse table-fixed min-w-[980px]" data-testid={`grid-table-${label.toLowerCase().replace(/\s+/g, "-")}`}>
          <colgroup>
            <col style={{ width: "150px" }} />
            {dates.map(d => <col key={d} style={{ width: "calc((100% - 150px - 220px) / 7)" }} />)}
            <col style={{ width: "70px" }} />
            <col style={{ width: "70px" }} />
            <col style={{ width: "80px" }} />
          </colgroup>
          <thead>
            <tr className="bg-muted/20 border-b border-border/40">
              <th className="px-3 py-1.5 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide border-r border-border/30">
                Employee
              </th>
              {dates.map((d, i) => {
                const t = dayTotals(d);
                return (
                  <th
                    key={d}
                    className={`px-1 py-1.5 text-center text-xs font-medium border-r border-border/30 ${i >= 5 ? "bg-amber-50/50 dark:bg-amber-950/20" : ""}`}
                    data-testid={`grid-header-day-${d}`}
                  >
                    <div className="text-[11px]">{DAY_NAMES[i]} {dayOfMonth(d)}</div>
                    {(t.roster > 0 || t.actual > 0) && (
                      <div className="leading-tight">
                        <span className="text-[9px] font-normal text-muted-foreground/70">{t.roster.toFixed(1)}h</span>
                        {" / "}
                        <span className="text-[10px] font-bold text-foreground">{t.actual.toFixed(1)}h</span>
                      </div>
                    )}
                  </th>
                );
              })}
              <th className="px-1 py-1.5 text-right text-[10px] font-semibold text-muted-foreground uppercase border-r border-border/30">Roster</th>
              <th className="px-1 py-1.5 text-right text-[10px] font-semibold text-muted-foreground uppercase border-r border-border/30">Actual</th>
              <th className="px-1 py-1.5 text-right text-[10px] font-semibold text-muted-foreground uppercase">Diff</th>
            </tr>
          </thead>
          <tbody>
            {weekRows.length === 0 ? (
              <tr>
                <td colSpan={11} className="py-4 px-4 text-sm text-muted-foreground italic text-center">
                  No records this week
                </td>
              </tr>
            ) : weekRows.map(row => {
              const t = weekTotals(row);
              return (
                <tr key={row.employeeId} className="border-b border-border/20" data-testid={`grid-row-${row.employeeId}`}>
                  <td className="px-3 py-1 border-r border-border/30 align-top">
                    <div className="font-semibold text-xs truncate">{row.displayName}</div>
                    <div className="text-[10px] text-muted-foreground truncate">{row.fullName}</div>
                  </td>
                  {dates.map((d, i) => (
                    <td
                      key={d}
                      className={`px-0.5 py-1 border-r border-border/30 align-top ${i >= 5 ? "bg-amber-50/30 dark:bg-amber-950/10" : ""}`}
                      data-testid={`grid-cell-${row.employeeId}-${d}`}
                    >
                      <DayCell entries={row.cells.get(d) ?? []} />
                    </td>
                  ))}
                  <td className="px-1 py-1 text-right align-top border-r border-border/30 text-[11px] text-muted-foreground tabular-nums">
                    {t.roster > 0 ? fmtHours(t.roster) : "—"}
                  </td>
                  <td className="px-1 py-1 text-right align-top border-r border-border/30 text-[11px] font-bold tabular-nums">
                    {t.actual > 0 ? fmtHours(t.actual) : "—"}
                  </td>
                  <td className="px-1 py-1 text-right align-top">
                    {t.diff !== 0
                      ? <DiffBadge diffMinutes={t.diff} />
                      : <span className="text-[11px] text-muted-foreground/40">—</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Mobile: week toggle + day ribbon + per-employee cards ────────────────────

function MobileDayList({
  rows,
  weekDates,
  selectedDay,
  onDayChange,
  activeWeek,
  onWeekChange,
}: {
  rows: AttendanceRow[];
  weekDates: string[];
  selectedDay: string;
  onDayChange: (d: string) => void;
  activeWeek: 1 | 2;
  onWeekChange: (w: 1 | 2) => void;
}) {
  const dayRows = rows
    .map(row => ({ row, entries: row.cells.get(selectedDay) ?? [] }))
    .filter(x => x.entries.length > 0);

  return (
    <div className="md:hidden space-y-2">
      {/* Week toggle — 14 tabs in one row is unreadable on a phone */}
      <div className="flex gap-1 bg-muted/40 rounded-lg p-0.5">
        {([1, 2] as const).map(w => (
          <button
            key={w}
            type="button"
            onClick={() => onWeekChange(w)}
            className={`flex-1 py-1.5 rounded-md text-xs transition-colors ${
              activeWeek === w ? "bg-background shadow-sm font-semibold" : "text-muted-foreground"
            }`}
            data-testid={`grid-week-tab-${w}`}
          >
            Week {w}
          </button>
        ))}
      </div>

      {/* Day ribbon */}
      <div className="flex gap-1">
        {weekDates.map((d, i) => {
          const isActive = d === selectedDay;
          const hasAny = rows.some(r => (r.cells.get(d) ?? []).length > 0);
          return (
            <button
              key={d}
              type="button"
              onClick={() => onDayChange(d)}
              className={`flex-1 flex flex-col items-center pt-1.5 pb-1 rounded-md text-xs transition-colors ${
                isActive ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted"
              }`}
              data-testid={`grid-day-tab-${i}`}
            >
              <span className="text-[10px] font-medium uppercase tracking-wide">{DAY_NAMES[i]}</span>
              <span className="text-sm font-bold leading-tight mt-0.5">{dayOfMonth(d)}</span>
              <span className={`mt-1 h-0.5 rounded-full transition-all ${
                isActive ? "w-4 bg-primary" : hasAny ? "w-1 bg-muted-foreground/40" : "w-0"
              }`} />
            </button>
          );
        })}
      </div>

      {dayRows.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-10 text-center">
          <CalendarOff className="h-8 w-8 text-muted-foreground/30 mb-2" />
          <p className="text-sm text-muted-foreground">No roster or attendance this day</p>
        </div>
      ) : (
        dayRows.map(({ row, entries }) => (
          <div
            key={row.employeeId}
            className="rounded-xl border border-border/40 bg-card px-3 py-2.5"
            data-testid={`grid-mobile-card-${row.employeeId}`}
          >
            <div className="font-bold text-sm mb-1.5">{row.displayName}</div>
            <div className="space-y-1.5">
              {entries.map(e => (
                <div key={e.storeId} className="flex items-start gap-2">
                  <span className="h-2 w-2 rounded-full shrink-0 mt-1.5" style={{ backgroundColor: e.storeColor }} />
                  <div className="min-w-0 flex-1">
                    <div className="text-[10px] text-muted-foreground">{e.storeName}</div>
                    <div className="flex items-baseline gap-2 flex-wrap">
                      <span className="text-xs text-muted-foreground/70 tabular-nums">
                        Roster {e.roster ? `${e.roster.start}–${e.roster.end}` : "—"}
                      </span>
                      <span className="text-sm font-bold tabular-nums">
                        {e.actual ? `${e.actual.start}–${e.actual.end}` : "no record"}
                      </span>
                      {e.status === "DIFF" && <DiffBadge diffMinutes={e.diffMinutes} />}
                      {e.status === "NO_SHOW" && (
                        <span className="text-[10px] font-medium text-amber-600 dark:text-amber-400">No show</span>
                      )}
                      {e.status === "UNSCHEDULED" && (
                        <span className="text-[10px] italic text-purple-600 dark:text-purple-400">Unsched</span>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))
      )}
    </div>
  );
}

// ── Public component ─────────────────────────────────────────────────────────

export function AttendanceGridView({
  rows,
  cycleStart,
  hasRosterData,
  selectedDay,
  onDayChange,
}: {
  rows: AttendanceRow[];
  cycleStart: string;
  hasRosterData: boolean;
  selectedDay: string;
  onDayChange: (d: string) => void;
}) {
  const week2Start = addDays(cycleStart, 7);
  const activeWeek: 1 | 2 = selectedDay >= week2Start ? 2 : 1;
  const mobileWeekStart = activeWeek === 2 ? week2Start : cycleStart;
  const mobileWeekDates = Array.from({ length: 7 }, (_, i) => addDays(mobileWeekStart, i));

  return (
    <div className="space-y-3" data-testid="attendance-grid-view">
      {!hasRosterData && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-50/50 dark:bg-amber-950/20 px-3 py-2">
          <AlertCircle className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
          <p className="text-xs text-amber-800 dark:text-amber-300">
            No roster data for this cycle — every shift shows as unscheduled because
            nothing was rostered, not because staff worked without a schedule.
          </p>
        </div>
      )}

      {/* Legend */}
      <div className="hidden md:flex items-center gap-4 text-[10px] text-muted-foreground px-1">
        <span className="flex items-center gap-1.5">
          <span className="text-muted-foreground/70 tabular-nums">09:00–17:00</span> Roster
        </span>
        <span className="flex items-center gap-1.5">
          <span className="font-semibold text-foreground tabular-nums">09:00–17:00</span> Actual
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-3 w-5 rounded border border-dashed border-muted-foreground/40 bg-muted/20" /> No show
        </span>
        <span className="flex items-center gap-1.5">
          <span className="italic text-purple-600 dark:text-purple-400">Unsched</span> No roster
        </span>
      </div>

      {/* Desktop: Week 1 / Week 2 stacked */}
      <div className="hidden md:block space-y-3">
        <WeekTable label="Week 1" weekStart={cycleStart} rows={rows} />
        <WeekTable label="Week 2" weekStart={week2Start} rows={rows} />
      </div>

      <MobileDayList
        rows={rows}
        weekDates={mobileWeekDates}
        selectedDay={selectedDay}
        onDayChange={onDayChange}
        activeWeek={activeWeek}
        onWeekChange={w => onDayChange(w === 2 ? week2Start : cycleStart)}
      />
    </div>
  );
}
