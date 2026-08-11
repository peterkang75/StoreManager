// Timeline View — one day, employees as columns, time running down the page.
//
// Forked from Rosters.tsx `DailyTimeline` (already read-only, so it ports cleanly),
// with one deliberate change: the colour system.
//
// Rosters cycles ten hues by employee index. That fights the faint-vs-solid contrast
// which is the entire point here, so instead:
//   roster → pale neutral band, full column width
//   actual → store brand colour, solid, narrower, inset on top of the band
// Whether the solid bar fills, falls short of, or overflows the pale band is then
// readable at a glance across the whole day.

import { AlertCircle, Clock, MessageSquareText } from "lucide-react";
import {
  addDays,
  dayOfMonth,
  DAY_NAMES,
  entriesForDate,
  fmtDiffMinutes,
  hoursDiffMinutes,
  timelineBarColors,
  toMins,
  type AttendanceRow,
} from "./attendanceModel";

const HOUR_PX = 30;
const TIME_COL_W = 46;

/** Round down / up to a whole hour. */
const floorHour = (m: number) => Math.floor(m / 60) * 60;
const ceilHour = (m: number) => Math.ceil(m / 60) * 60;

export function AttendanceTimelineView({
  rows,
  cycleStart,
  selectedDay,
  onDayChange,
  openTime,
  closeTime,
  storeName,
  hasRosterData,
}: {
  rows: AttendanceRow[];
  cycleStart: string;
  selectedDay: string;
  onDayChange: (d: string) => void;
  openTime: string;
  closeTime: string;
  storeName: string;
  hasRosterData: boolean;
}) {
  const week2Start = addDays(cycleStart, 7);
  const activeWeek: 1 | 2 = selectedDay >= week2Start ? 2 : 1;
  const weekStart = activeWeek === 2 ? week2Start : cycleStart;
  const weekDates = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));

  const dayEntries = entriesForDate(rows, selectedDay);

  // Axis spans store hours, widened to contain anything that fell outside them.
  // Clamping instead would hide overtime — the case the view exists to surface.
  let axisStart = floorHour(toMins(openTime));
  let axisEnd = ceilHour(toMins(closeTime));
  dayEntries.forEach(({ entry }) => {
    [entry.roster, entry.actual].forEach(seg => {
      if (!seg) return;
      const s = toMins(seg.start);
      const e = toMins(seg.end);
      axisStart = Math.min(axisStart, floorHour(s));
      // An end before its start means the shift ran past midnight — extend to the
      // end of the day rather than drawing a negative-height block.
      axisEnd = Math.max(axisEnd, e <= s ? 24 * 60 : ceilHour(e));
    });
  });
  if (axisEnd <= axisStart) axisEnd = axisStart + 60;

  const totalHours = (axisEnd - axisStart) / 60;
  const GRID_HEIGHT = totalHours * HOUR_PX;

  const hourTicks: { mins: number; label: string }[] = [];
  for (let m = axisStart; m <= axisEnd; m += 60) {
    hourTicks.push({ mins: m, label: `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:00` });
  }

  const yPx = (mins: number) => ((mins - axisStart) / 60) * HOUR_PX;
  const segPx = (start: string, end: string) => {
    const s = toMins(start);
    const e = toMins(end) <= s ? axisEnd : toMins(end);
    return { top: yPx(s), height: Math.max(6, yPx(e) - yPx(s)) };
  };

  const dayRosterHours = dayEntries.reduce((s, { entry }) => s + (entry.roster?.hours ?? 0), 0);
  const dayActualHours = dayEntries.reduce((s, { entry }) => s + (entry.actual?.hours ?? 0), 0);
  const dayDiffMinutes = hoursDiffMinutes(dayActualHours, dayRosterHours);

  return (
    <div className="rounded-lg border border-border/40 bg-card overflow-hidden" data-testid="attendance-timeline-view">
      {!hasRosterData && (
        <div className="flex items-start gap-2 border-b border-amber-500/30 bg-amber-50/50 dark:bg-amber-950/20 px-3 py-2">
          <AlertCircle className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
          <p className="text-xs text-amber-800 dark:text-amber-300">
            No roster data for this cycle — bars show actual attendance only.
          </p>
        </div>
      )}

      {/* Week toggle */}
      <div className="px-3 pt-2">
        <div className="flex gap-1 bg-muted/40 rounded-lg p-0.5">
          {([1, 2] as const).map(w => (
            <button
              key={w}
              type="button"
              onClick={() => onDayChange(w === 2 ? week2Start : cycleStart)}
              className={`flex-1 py-1.5 rounded-md text-xs transition-colors ${
                activeWeek === w ? "bg-background shadow-sm font-semibold" : "text-muted-foreground"
              }`}
              data-testid={`timeline-week-tab-${w}`}
            >
              Week {w}
            </button>
          ))}
        </div>
      </div>

      {/* Day tabs */}
      <div className="px-3 py-2 border-b border-border/30">
        <div className="flex gap-0.5 bg-muted/40 rounded-lg p-0.5">
          {weekDates.map((d, i) => {
            const isActive = d === selectedDay;
            const hasAny = rows.some(r => (r.cells.get(d) ?? []).length > 0);
            return (
              <button
                key={d}
                type="button"
                onClick={() => onDayChange(d)}
                className={`flex-1 flex flex-col items-center py-1.5 rounded-md text-xs transition-colors min-w-0 ${
                  isActive
                    ? "bg-background shadow-sm text-foreground font-semibold"
                    : "text-muted-foreground hover:text-foreground"
                }`}
                data-testid={`timeline-day-tab-${i}`}
              >
                <span className="text-[10px] font-medium">{DAY_NAMES[i]}</span>
                <span className="text-sm font-bold">{dayOfMonth(d)}</span>
                <span className={`mt-0.5 h-1 w-1 rounded-full ${
                  isActive ? "bg-primary" : hasAny ? "bg-muted-foreground/50" : "bg-transparent"
                }`} />
              </button>
            );
          })}
        </div>
      </div>

      {/* Stats + legend */}
      <div className="px-3 py-2 border-b border-border/30 bg-muted/20 flex items-center gap-4 flex-wrap text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <Clock className="h-3 w-3" />
          Roster <span className="font-medium text-foreground">{dayRosterHours.toFixed(1)}h</span>
          {" · "}
          Actual <span className="font-bold text-foreground">{dayActualHours.toFixed(1)}h</span>
          {dayDiffMinutes !== 0 && (
            <span className={`font-semibold ${dayDiffMinutes > 0 ? "text-orange-600 dark:text-orange-400" : "text-blue-600 dark:text-blue-400"}`}>
              {fmtDiffMinutes(dayDiffMinutes)}
            </span>
          )}
        </span>
        <span className="flex-1" />
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-3 w-4 rounded-sm bg-muted-foreground/20 border border-muted-foreground/30" />
          Roster
        </span>
        <span className="flex items-center gap-1.5">
          {(() => {
            const c = timelineBarColors(dayEntries[0]?.entry.storeColor ?? "#6a6a6a");
            return (
              <span
                className="inline-block h-3 w-2.5 rounded-sm bg-[var(--bar-bg)] dark:bg-[var(--bar-bg-dark)]"
                style={{ ["--bar-bg" as any]: c.bgLight, ["--bar-bg-dark" as any]: c.bgDark }}
              />
            );
          })()}
          Actual — {storeName}
        </span>
      </div>

      {dayEntries.length === 0 ? (
        <div className="flex items-center justify-center py-10 text-muted-foreground text-sm">
          No roster or attendance for this day.
        </div>
      ) : (
        <div className="overflow-x-auto px-3 pb-3">
          <div style={{ minWidth: `${TIME_COL_W + dayEntries.length * 56}px` }}>
            {/* Column headers */}
            <div className="flex border-b border-border/30">
              <div className="shrink-0 border-r border-border/30" style={{ width: `${TIME_COL_W}px` }} />
              {dayEntries.map(({ row, entry }) => (
                <div
                  key={`${row.employeeId}-${entry.storeId}`}
                  className="flex-1 min-w-0 flex flex-col items-center justify-center py-1.5 px-1 border-r border-border/20 last:border-r-0"
                  data-testid={`timeline-col-${row.employeeId}`}
                >
                  <span className="text-[11px] font-semibold truncate w-full text-center leading-none">
                    {row.displayName}
                  </span>
                  <span className="text-[9px] text-muted-foreground leading-none mt-0.5 tabular-nums">
                    {entry.roster ? `${entry.roster.hours.toFixed(1)}` : "—"}
                    {" / "}
                    <span className="font-bold text-foreground">
                      {entry.actual ? entry.actual.hours.toFixed(1) : "—"}
                    </span>h
                  </span>
                </div>
              ))}
            </div>

            {/* Grid body */}
            <div className="flex" style={{ height: `${GRID_HEIGHT}px` }}>
              {/* Time axis */}
              <div className="shrink-0 relative border-r border-border/30" style={{ width: `${TIME_COL_W}px` }}>
                {hourTicks.map(({ mins, label }) => (
                  <div key={mins} className="absolute right-0 flex items-center" style={{ top: `${yPx(mins)}px` }}>
                    <span className="text-[9px] text-muted-foreground pr-1 select-none leading-none -translate-y-1/2 tabular-nums">
                      {label}
                    </span>
                  </div>
                ))}
              </div>

              {/* Employee columns */}
              {dayEntries.map(({ row, entry }) => {
                const rosterBox = entry.roster ? segPx(entry.roster.start, entry.roster.end) : null;
                const actualBox = entry.actual ? segPx(entry.actual.start, entry.actual.end) : null;
                return (
                  <div
                    key={`${row.employeeId}-${entry.storeId}`}
                    className="flex-1 relative border-r border-border/20 last:border-r-0"
                    data-testid={`timeline-track-${row.employeeId}`}
                    data-status={entry.status}
                  >
                    {hourTicks.map(({ mins }) => (
                      <div
                        key={mins}
                        className="absolute left-0 right-0 border-t border-border/30"
                        style={{ top: `${yPx(mins)}px` }}
                      />
                    ))}

                    {/* Roster — pale band, full width */}
                    {rosterBox && (
                      <div
                        className={`absolute inset-x-0.5 rounded-sm bg-muted-foreground/15 ${
                          entry.status === "NO_SHOW"
                            ? "border border-dashed border-muted-foreground/50"
                            : "border border-muted-foreground/20"
                        }`}
                        style={{ top: `${rosterBox.top}px`, height: `${rosterBox.height}px` }}
                        title={`Roster ${entry.roster!.start}–${entry.roster!.end} (${entry.roster!.hours.toFixed(1)}h)`}
                      >
                        {entry.status === "NO_SHOW" && rosterBox.height >= 24 && (
                          <span className="absolute inset-0 flex items-center justify-center text-[8px] font-medium text-muted-foreground text-center leading-tight px-0.5">
                            no record
                          </span>
                        )}
                      </div>
                    )}

                    {/* Actual — solid, inset on top of the band */}
                    {actualBox && (() => {
                      const c = timelineBarColors(entry.storeColor);
                      return (
                        <div
                          className="absolute rounded-sm shadow-sm overflow-hidden bg-[var(--bar-bg)] dark:bg-[var(--bar-bg-dark)] text-[color:var(--bar-fg)] dark:text-[color:var(--bar-fg-dark)]"
                          style={{
                            top: `${actualBox.top}px`,
                            height: `${actualBox.height}px`,
                            left: "25%",
                            right: "25%",
                            ["--bar-bg" as any]: c.bgLight,
                            ["--bar-fg" as any]: c.fgLight,
                            ["--bar-bg-dark" as any]: c.bgDark,
                            ["--bar-fg-dark" as any]: c.fgDark,
                          }}
                          title={
                            `Actual ${entry.actual!.start}–${entry.actual!.end} (${entry.actual!.hours.toFixed(1)}h)` +
                            (entry.actual!.reason ? `\nReason: ${entry.actual!.reason}` : "")
                          }
                        >
                          {actualBox.height >= 20 && (
                            <div className="flex flex-col p-0.5 leading-none gap-px">
                              <span className="text-[8px] font-bold whitespace-nowrap leading-none tabular-nums">
                                {entry.actual!.start}
                              </span>
                              {actualBox.height >= 34 && (
                                <span className="text-[8px] opacity-80 whitespace-nowrap leading-none tabular-nums">
                                  {entry.actual!.end}
                                </span>
                              )}
                            </div>
                          )}
                          {/* A column is far too narrow to hold the sentence, so the
                              bar only flags that one exists; the text is listed
                              under the grid where it has room to be read. */}
                          {entry.actual!.reason && (
                            <MessageSquareText className="absolute bottom-0.5 right-0.5 h-2.5 w-2.5 opacity-90" />
                          )}
                        </div>
                      );
                    })()}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* ── Staff explanations for the day ──────────────────────────────────
          The portal makes a reason mandatory whenever the employee changes
          either time, so this is where "why is the bar longer than the band?"
          gets answered in their own words. */}
      {dayEntries.some(({ entry }) => entry.actual?.reason) && (
        <div className="border-t border-border/30 px-3 py-2 space-y-1.5" data-testid="timeline-reasons">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Staff notes
          </p>
          {dayEntries
            .filter(({ entry }) => entry.actual?.reason)
            .map(({ row, entry }) => (
              <div
                key={`${row.employeeId}-${entry.storeId}-note`}
                className="flex items-start gap-2 text-xs"
                data-testid={`timeline-reason-${row.employeeId}`}
              >
                <MessageSquareText className="h-3 w-3 shrink-0 mt-0.5 text-muted-foreground" />
                <span className="font-semibold shrink-0">{row.displayName}</span>
                <span className="text-muted-foreground shrink-0 tabular-nums">
                  {entry.actual!.start}–{entry.actual!.end}
                </span>
                {entry.status === "DIFF" && (
                  <span className={`shrink-0 font-semibold ${entry.diffMinutes > 0 ? "text-orange-600 dark:text-orange-400" : "text-blue-600 dark:text-blue-400"}`}>
                    {fmtDiffMinutes(entry.diffMinutes)}
                  </span>
                )}
                {entry.status === "UNSCHEDULED" && (
                  <span className="shrink-0 italic text-purple-600 dark:text-purple-400">Unsched</span>
                )}
                <span className="text-foreground min-w-0">"{entry.actual!.reason}"</span>
              </div>
            ))}
        </div>
      )}

      {/* A shift that ran over roster with nothing written is the case worth
          chasing — the portal requires a reason, but a manager editing the times
          afterwards (PUT /api/admin/approvals/:id/update-times) does not. */}
      {dayEntries.some(({ entry }) => entry.status === "DIFF" && entry.diffMinutes > 0 && !entry.actual?.reason) && (
        <div className="border-t border-border/30 px-3 py-2 flex items-start gap-2" data-testid="timeline-missing-reasons">
          <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" />
          <p className="text-xs text-muted-foreground">
            <span className="font-semibold text-foreground">No reason recorded</span>
            {" — "}
            {dayEntries
              .filter(({ entry }) => entry.status === "DIFF" && entry.diffMinutes > 0 && !entry.actual?.reason)
              .map(({ row, entry }) => `${row.displayName} ${fmtDiffMinutes(entry.diffMinutes)}`)
              .join(", ")}
          </p>
        </div>
      )}
    </div>
  );
}
