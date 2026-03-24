import { useState, useMemo, useCallback, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { AdminLayout } from "@/components/layouts/AdminLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  CheckCircle2,
  Clock,
  X,
  Loader2,
  ClipboardCheck,
  TrendingUp,
  TrendingDown,
  ChevronLeft,
  ChevronRight,
  DollarSign,
  Wand2,
  User,
  ArrowRight,
  Plus,
  Minus,
} from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { getPayrollCycleStart, getPayrollCycleEnd, shiftDate } from "@shared/payrollCycle";

// ── Types ──────────────────────────────────────────────────────────────────────

interface EnrichedTimesheet {
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

interface EmployeeGroup {
  employeeId: string;
  employeeName: string;
  employeeNickname: string | null;
  timesheets: EnrichedTimesheet[];
  totalActualHours: number;
  totalScheduledHours: number;
  diffMinutes: number;
  storeNames: string[];
  pendingCount: number;
}

// ── Date / Time Helpers ────────────────────────────────────────────────────────

function getAEDTToday(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Australia/Sydney" });
}

function toYMD(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function addDays(dateStr: string, n: number): string {
  const d = new Date(dateStr + "T00:00:00");
  d.setDate(d.getDate() + n);
  return toYMD(d);
}

function fmtCycleDate(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-AU", { day: "2-digit", month: "short", year: "numeric" });
}

function toMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

function fmtTime(time: string | null): string {
  if (!time) return "—";
  const [h, m] = time.split(":").map(Number);
  const period = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 || 12;
  return `${h12}:${String(m).padStart(2, "0")} ${period}`;
}

function calcHours(start: string, end: string): number {
  const diff = toMinutes(end) - toMinutes(start);
  return diff < 0 ? (diff + 1440) / 60 : diff / 60;
}

function fmtHours(h: number): string {
  const hh = Math.floor(h);
  const mm = Math.round((h - hh) * 60);
  if (mm === 0) return `${hh}h`;
  return `${hh}h ${mm}m`;
}

function fmtDate(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short" });
}

function fmtDiffMinutes(diffMin: number): string {
  const abs = Math.abs(diffMin);
  const hh = Math.floor(abs / 60);
  const mm = Math.round(abs % 60);
  const sign = diffMin > 0 ? "+" : "-";
  if (hh === 0) return `${sign}${mm}m`;
  if (mm === 0) return `${sign}${hh}h`;
  return `${sign}${hh}h ${mm}m`;
}

/** Adds deltaMinutes to a "HH:MM" string, wrapping around midnight */
function adjustTime(time: string, deltaMinutes: number): string {
  const [h, m] = time.split(":").map(Number);
  let total = h * 60 + m + deltaMinutes;
  total = ((total % 1440) + 1440) % 1440;
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

const STORE_COLORS: Record<string, string> = {
  Sushi: "#16a34a",
  Sandwich: "#dc2626",
};
function storeColor(n: string): string {
  return STORE_COLORS[n] ?? "#6366f1";
}

// ── Group by employee ──────────────────────────────────────────────────────────

function groupByEmployee(timesheets: EnrichedTimesheet[]): EmployeeGroup[] {
  const map = new Map<string, EmployeeGroup>();
  timesheets.forEach(ts => {
    if (!map.has(ts.employeeId)) {
      map.set(ts.employeeId, {
        employeeId: ts.employeeId,
        employeeName: ts.employeeName,
        employeeNickname: ts.employeeNickname,
        timesheets: [],
        totalActualHours: 0,
        totalScheduledHours: 0,
        diffMinutes: 0,
        storeNames: [],
        pendingCount: 0,
      });
    }
    const g = map.get(ts.employeeId)!;
    g.timesheets.push(ts);
    const actual = calcHours(ts.actualStartTime, ts.actualEndTime);
    g.totalActualHours += actual;
    if (ts.scheduledStartTime && ts.scheduledEndTime) {
      const sched = calcHours(ts.scheduledStartTime, ts.scheduledEndTime);
      g.totalScheduledHours += sched;
      g.diffMinutes += Math.round((actual - sched) * 60);
    }
    if (!g.storeNames.includes(ts.storeName)) g.storeNames.push(ts.storeName);
    if (ts.status === "PENDING") g.pendingCount++;
  });
  return Array.from(map.values()).sort((a, b) =>
    (a.employeeNickname || a.employeeName).localeCompare(b.employeeNickname || b.employeeName)
  );
}

// ── Diff Display ───────────────────────────────────────────────────────────────

function DiffCell({ diffMinutes, className = "" }: { diffMinutes: number; className?: string }) {
  if (diffMinutes === 0) return <span className={`text-muted-foreground text-sm ${className}`}>—</span>;
  const isOver = diffMinutes > 0;
  const color = isOver
    ? "text-orange-600 dark:text-orange-400"
    : "text-blue-600 dark:text-blue-400";
  return (
    <span className={`text-sm font-semibold ${color} ${className}`} data-testid="diff-cell">
      {isOver ? <TrendingUp className="inline h-3 w-3 mr-0.5" /> : <TrendingDown className="inline h-3 w-3 mr-0.5" />}
      {fmtDiffMinutes(diffMinutes)}
    </span>
  );
}

// ── Employee Review Modal ──────────────────────────────────────────────────────

function EmployeeReviewModal({
  group,
  cycleStart,
  cycleEnd,
  onClose,
  onSaved,
}: {
  group: EmployeeGroup;
  cycleStart: string;
  cycleEnd: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const displayName = group.employeeNickname || group.employeeName.split(" ")[0];
  const isMultiStore = group.storeNames.length > 1;

  // Editable times per timesheet (keyed by timesheet ID)
  const [edits, setEdits] = useState<Record<string, { start: string; end: string }>>(() => {
    const init: Record<string, { start: string; end: string }> = {};
    group.timesheets.forEach(ts => {
      init[ts.id] = { start: ts.actualStartTime, end: ts.actualEndTime };
    });
    return init;
  });

  // Auto-save state per row
  const [savingIds, setSavingIds] = useState<Set<string>>(new Set());
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());
  const savedTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  // Bulk approve state
  const [approving, setApproving] = useState(false);

  const pendingShifts = group.timesheets.filter(ts => ts.status === "PENDING");

  // Live-computed totals from edits (reactive)
  const liveActualHours = group.timesheets.reduce((sum, ts) => {
    const e = edits[ts.id];
    return sum + (e ? calcHours(e.start, e.end) : 0);
  }, 0);

  // Auto-save a single timesheet's times — accepts optional override to use fresh values
  const autoSave = useCallback(async (tsId: string, overrideStart?: string, overrideEnd?: string) => {
    const e = edits[tsId];
    const start = overrideStart ?? e?.start;
    const end   = overrideEnd   ?? e?.end;
    if (!start || !end) return;
    setSavingIds(prev => new Set(prev).add(tsId));
    try {
      await apiRequest("PUT", `/api/admin/approvals/${tsId}/update-times`, {
        actualStartTime: start,
        actualEndTime: end,
      });
      setSavingIds(prev => { const n = new Set(prev); n.delete(tsId); return n; });
      setSavedIds(prev => new Set(prev).add(tsId));
      if (savedTimers.current[tsId]) clearTimeout(savedTimers.current[tsId]);
      savedTimers.current[tsId] = setTimeout(() => {
        setSavedIds(prev => { const n = new Set(prev); n.delete(tsId); return n; });
      }, 2500);
    } catch {
      setSavingIds(prev => { const n = new Set(prev); n.delete(tsId); return n; });
      toast({ title: "Save failed", description: "Could not update timesheet times.", variant: "destructive" });
    }
  }, [edits, toast]);

  // ±15-min quick-adjust — updates state AND auto-saves immediately
  const handleAdjust = useCallback((tsId: string, field: "start" | "end", delta: number) => {
    const e = edits[tsId];
    if (!e) return;
    const newTime = adjustTime(e[field], delta);
    const newStart = field === "start" ? newTime : e.start;
    const newEnd   = field === "end"   ? newTime : e.end;
    setEdits(prev => ({ ...prev, [tsId]: { start: newStart, end: newEnd } }));
    autoSave(tsId, newStart, newEnd);
  }, [edits, autoSave]);

  // Approve all pending shifts (times already auto-saved)
  const handleApproveAll = async () => {
    setApproving(true);
    try {
      await Promise.all(pendingShifts.map(ts =>
        apiRequest("PUT", `/api/admin/approvals/${ts.id}/approve`)
      ));
      queryClient.invalidateQueries({ queryKey: ["/api/admin/approvals"] });
      toast({
        title: `${pendingShifts.length} Shift${pendingShifts.length !== 1 ? "s" : ""} Approved`,
        description: `${displayName}'s timesheets for this cycle are now approved.`,
      });
      onSaved();
    } catch {
      toast({ title: "Error", description: "Some timesheets failed to approve.", variant: "destructive" });
    } finally {
      setApproving(false);
    }
  };

  // Split into two 7-day weeks
  const allSorted = [...group.timesheets].sort((a, b) => a.date.localeCompare(b.date));
  const week1End = addDays(cycleStart, 6);
  const week2Start = addDays(cycleStart, 7);
  const week1Shifts = allSorted.filter(ts => ts.date <= week1End);
  const week2Shifts = allSorted.filter(ts => ts.date >= week2Start);

  // Per-week live totals
  const week1Hours = week1Shifts.reduce((s, ts) => { const e = edits[ts.id]; return s + (e ? calcHours(e.start, e.end) : 0); }, 0);
  const week2Hours = week2Shifts.reduce((s, ts) => { const e = edits[ts.id]; return s + (e ? calcHours(e.start, e.end) : 0); }, 0);

  // Reusable row renderer
  const renderShiftRow = (ts: EnrichedTimesheet) => {
    const e = edits[ts.id];
    const actualH = e ? calcHours(e.start, e.end) : 0;
    const schedH = ts.scheduledStartTime && ts.scheduledEndTime
      ? calcHours(ts.scheduledStartTime, ts.scheduledEndTime) : null;
    const shiftDiffMin = schedH !== null ? Math.round((actualH - schedH) * 60) : 0;
    const isPending = ts.status === "PENDING";
    const isApproved = ts.status === "APPROVED";
    const isSaving = savingIds.has(ts.id);
    const justSaved = savedIds.has(ts.id);

    const TimeAdjustCell = ({ field }: { field: "start" | "end" }) => (
      <div className="flex items-center gap-0.5">
        <button
          type="button"
          onClick={() => handleAdjust(ts.id, field, -15)}
          className="h-7 w-6 flex items-center justify-center rounded text-muted-foreground hover-elevate active-elevate-2 shrink-0"
          data-testid={`button-${field}-minus-${ts.id}`}
        >
          <Minus className="h-3 w-3" />
        </button>
        <Input
          type="time"
          value={e?.[field] ?? (field === "start" ? ts.actualStartTime : ts.actualEndTime)}
          onChange={ev => setEdits(prev => ({
            ...prev,
            [ts.id]: { ...prev[ts.id], [field]: ev.target.value },
          }))}
          onBlur={() => autoSave(ts.id)}
          className="font-mono h-7 text-xs px-1 w-[82px] shrink-0"
          data-testid={`input-${field}-${ts.id}`}
        />
        <button
          type="button"
          onClick={() => handleAdjust(ts.id, field, 15)}
          className="h-7 w-6 flex items-center justify-center rounded text-muted-foreground hover-elevate active-elevate-2 shrink-0"
          data-testid={`button-${field}-plus-${ts.id}`}
        >
          <Plus className="h-3 w-3" />
        </button>
      </div>
    );

    return (
      <tr
        key={ts.id}
        className={`border-b border-border/20 ${isApproved ? "opacity-55" : ""}`}
        data-testid={`review-row-${ts.id}`}
      >
        {/* Date + optional store badge */}
        <td className="py-1.5 px-2 whitespace-nowrap">
          <div className="flex items-center gap-1.5">
            <span className="font-medium text-sm">{fmtDate(ts.date)}</span>
            {isMultiStore && (
              <span
                className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full text-white shrink-0"
                style={{ backgroundColor: storeColor(ts.storeName) }}
              >
                {ts.storeName}
              </span>
            )}
          </div>
        </td>

        {/* Scheduled */}
        <td className="py-1.5 px-2 whitespace-nowrap text-muted-foreground text-xs">
          {ts.scheduledStartTime && ts.scheduledEndTime
            ? `${fmtTime(ts.scheduledStartTime)} – ${fmtTime(ts.scheduledEndTime)}`
            : <span className="text-purple-600 dark:text-purple-400 font-medium">Unscheduled</span>
          }
        </td>

        {/* Start */}
        <td className="py-1 px-1">
          {isPending
            ? <TimeAdjustCell field="start" />
            : <span className="font-mono text-sm text-muted-foreground px-1">{fmtTime(ts.actualStartTime)}</span>
          }
        </td>

        {/* End */}
        <td className="py-1 px-1">
          {isPending
            ? <TimeAdjustCell field="end" />
            : <span className="font-mono text-sm text-muted-foreground px-1">{fmtTime(ts.actualEndTime)}</span>
          }
        </td>

        {/* Diff */}
        <td className="py-1.5 px-2 whitespace-nowrap">
          {schedH !== null
            ? <DiffCell diffMinutes={shiftDiffMin} />
            : <span className="text-muted-foreground text-sm">—</span>
          }
        </td>

        {/* Hours */}
        <td className="py-1.5 px-2 whitespace-nowrap font-semibold text-sm">
          {fmtHours(actualH)}
        </td>

        {/* Save indicator */}
        <td className="py-1.5 px-1 w-6 text-center">
          {isSaving && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
          {!isSaving && justSaved && <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />}
          {!isSaving && isApproved && !justSaved && <CheckCircle2 className="h-3.5 w-3.5 text-green-500/40" />}
        </td>
      </tr>
    );
  };

  // Week section header row
  const WeekHeader = ({ label, dateRange }: { label: string; dateRange: string }) => (
    <tr>
      <td colSpan={7} className="py-1.5 px-3 bg-muted/40 border-y border-border/30">
        <span className="text-xs font-bold uppercase tracking-widest text-muted-foreground">{label}</span>
        <span className="text-xs text-muted-foreground ml-2 font-normal">{dateRange}</span>
      </td>
    </tr>
  );

  // Week total row
  const WeekTotalRow = ({ label, hours }: { label: string; hours: number }) => (
    <tr className="bg-muted/20">
      <td colSpan={4} />
      <td colSpan={2} className="py-2 px-2 text-right">
        <span className="text-xs text-muted-foreground">{label}: </span>
        <span className="text-sm font-bold">{fmtHours(hours)}</span>
      </td>
      <td />
    </tr>
  );

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex flex-col justify-end md:justify-center md:items-center md:p-4"
      onClick={onClose}
    >
      <div
        className="w-full md:max-w-3xl bg-card md:rounded-xl rounded-t-2xl border border-border/40 shadow-2xl flex flex-col max-h-[94dvh] md:max-h-[88vh]"
        onClick={e => e.stopPropagation()}
        data-testid="employee-review-modal"
      >
        {/* Drag handle */}
        <div className="md:hidden flex justify-center pt-3 pb-1 shrink-0">
          <div className="w-10 h-1 rounded-full bg-muted-foreground/30" />
        </div>

        {/* Header */}
        <div className="flex items-start justify-between px-5 py-4 border-b border-border/40 shrink-0">
          <div>
            <h2 className="font-bold text-base flex items-center gap-2">
              <User className="h-4 w-4 text-primary" />
              {displayName}
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              {fmtCycleDate(cycleStart)} – {fmtCycleDate(cycleEnd)}
              {" · "}
              {pendingShifts.length} pending shift{pendingShifts.length !== 1 ? "s" : ""}
            </p>
            <div className="flex items-center gap-3 mt-1.5 flex-wrap">
              <span className="text-xs text-muted-foreground">
                Total actual: <span className="font-semibold text-foreground">{fmtHours(liveActualHours)}</span>
              </span>
              {group.totalScheduledHours > 0 && (
                <span className="text-xs text-muted-foreground">
                  Scheduled: <span className="font-semibold text-foreground">{fmtHours(group.totalScheduledHours)}</span>
                </span>
              )}
              <span className="text-[10px] text-muted-foreground italic">±15m buttons auto-save</span>
            </div>
          </div>
          <Button size="icon" variant="ghost" onClick={onClose} data-testid="button-modal-close">
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Scrollable table body */}
        <div className="overflow-y-auto flex-1">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm" data-testid="review-shifts-table">
              <thead className="sticky top-0 bg-muted/80 backdrop-blur-sm z-10">
                <tr className="border-b border-border/40">
                  <th className="py-2 px-2 text-xs font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap">Date</th>
                  <th className="py-2 px-2 text-xs font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap">Scheduled</th>
                  <th className="py-2 px-2 text-xs font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap" colSpan={1}>Start</th>
                  <th className="py-2 px-2 text-xs font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap" colSpan={1}>End</th>
                  <th className="py-2 px-2 text-xs font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap">Diff</th>
                  <th className="py-2 px-2 text-xs font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap">Hours</th>
                  <th className="py-2 px-2 w-6"></th>
                </tr>
              </thead>

              {/* ── Week 1 ── */}
              <tbody>
                <WeekHeader
                  label="Week 1"
                  dateRange={`${fmtCycleDate(cycleStart)} – ${fmtCycleDate(week1End)}`}
                />
                {week1Shifts.length > 0
                  ? week1Shifts.map(ts => renderShiftRow(ts))
                  : (
                    <tr>
                      <td colSpan={7} className="py-3 px-4 text-sm text-muted-foreground italic">No shifts this week</td>
                    </tr>
                  )
                }
                <WeekTotalRow label="Week 1 Total" hours={week1Hours} />
              </tbody>

              {/* ── Week 2 ── */}
              <tbody>
                <WeekHeader
                  label="Week 2"
                  dateRange={`${fmtCycleDate(week2Start)} – ${fmtCycleDate(cycleEnd)}`}
                />
                {week2Shifts.length > 0
                  ? week2Shifts.map(ts => renderShiftRow(ts))
                  : (
                    <tr>
                      <td colSpan={7} className="py-3 px-4 text-sm text-muted-foreground italic">No shifts this week</td>
                    </tr>
                  )
                }
                <WeekTotalRow label="Week 2 Total" hours={week2Hours} />
              </tbody>
            </table>
          </div>
        </div>

        {/* Pinned footer */}
        <div className="flex gap-2 px-5 py-4 border-t border-border/40 shrink-0 pb-[calc(1rem+env(safe-area-inset-bottom))]">
          <Button variant="outline" className="min-h-[44px]" onClick={onClose} data-testid="button-modal-cancel">
            Cancel
          </Button>
          {pendingShifts.length > 0 ? (
            <Button
              className="flex-1 min-h-[44px] bg-green-600 text-white font-semibold"
              onClick={handleApproveAll}
              disabled={approving || savingIds.size > 0}
              data-testid="button-approve-all"
            >
              {approving
                ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Approving…</>
                : savingIds.size > 0
                ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Saving changes…</>
                : <><CheckCircle2 className="h-4 w-4 mr-2" />Approve All for {displayName}</>
              }
            </Button>
          ) : (
            <div className="flex-1 flex items-center justify-center gap-2 text-sm text-green-600 dark:text-green-400 font-medium">
              <CheckCircle2 className="h-4 w-4" />
              All shifts already approved
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Employee Summary Card (mobile) ─────────────────────────────────────────────

function EmployeeSummaryCard({
  group,
  onReview,
}: {
  group: EmployeeGroup;
  onReview: () => void;
}) {
  const displayName = group.employeeNickname || group.employeeName.split(" ")[0];
  return (
    <div
      className="bg-card rounded-xl border border-border/40 shadow-sm p-4 flex flex-col gap-3"
      data-testid={`employee-card-${group.employeeId}`}
    >
      {/* Top row */}
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-bold text-base leading-tight">{displayName}</p>
          <div className="flex items-center gap-1.5 mt-1 flex-wrap">
            {group.storeNames.map(s => (
              <span
                key={s}
                className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full text-white"
                style={{ backgroundColor: storeColor(s) }}
              >
                {s}
              </span>
            ))}
            <span className="text-xs text-muted-foreground">
              {group.timesheets.length} shift{group.timesheets.length !== 1 ? "s" : ""}
            </span>
          </div>
        </div>
        <span className="shrink-0 text-xs font-medium text-muted-foreground bg-muted/60 px-2 py-1 rounded-md">
          {group.pendingCount} pending
        </span>
      </div>

      {/* Hours row */}
      <div className="grid grid-cols-3 gap-2">
        <div className="text-center">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-0.5">Scheduled</p>
          <p className="font-semibold text-sm">{group.totalScheduledHours > 0 ? fmtHours(group.totalScheduledHours) : "—"}</p>
        </div>
        <div className="text-center">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-0.5">Actual</p>
          <p className="font-semibold text-sm">{fmtHours(group.totalActualHours)}</p>
        </div>
        <div className="text-center">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-0.5">Diff</p>
          <DiffCell diffMinutes={group.diffMinutes} />
        </div>
      </div>

      {/* Action */}
      <Button
        className="w-full gap-2 h-9"
        onClick={onReview}
        data-testid={`button-review-${group.employeeId}`}
      >
        Review &amp; Approve
        <ArrowRight className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}

// ── Cycle Navigator ────────────────────────────────────────────────────────────

function CycleNavigator({
  cycleStart,
  onPrev,
  onNext,
  isCurrentCycle,
  onToday,
}: {
  cycleStart: string;
  onPrev: () => void;
  onNext: () => void;
  isCurrentCycle: boolean;
  onToday: () => void;
}) {
  const cycleEnd = getPayrollCycleEnd(cycleStart);
  return (
    <div className="flex items-center gap-1.5" data-testid="cycle-navigator">
      <Button
        size="icon"
        variant="outline"
        className="h-9 w-9 shrink-0"
        onClick={onPrev}
        data-testid="button-cycle-prev"
      >
        <ChevronLeft className="h-4 w-4" />
      </Button>

      <div className="flex-1 text-center min-w-0">
        <p className="text-sm font-semibold leading-tight whitespace-nowrap">
          {fmtCycleDate(cycleStart)} – {fmtCycleDate(cycleEnd)}
        </p>
        <p className="text-[10px] text-muted-foreground">14-day payroll cycle</p>
      </div>

      <Button
        size="icon"
        variant="outline"
        className="h-9 w-9 shrink-0"
        onClick={onNext}
        data-testid="button-cycle-next"
      >
        <ChevronRight className="h-4 w-4" />
      </Button>

      {!isCurrentCycle && (
        <Button
          variant="outline"
          size="sm"
          className="shrink-0 h-9 text-xs"
          onClick={onToday}
          data-testid="button-cycle-today"
        >
          This Cycle
        </Button>
      )}
    </div>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────────

export function AdminTimesheetApprovals() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [, navigate] = useLocation();

  // Cycle state — default to AEDT current payroll cycle
  const today = getAEDTToday();
  const currentCycleStart = getPayrollCycleStart(today);
  const [cycleStart, setCycleStart] = useState(currentCycleStart);
  const cycleEnd = getPayrollCycleEnd(cycleStart);
  const isCurrentCycle = cycleStart === currentCycleStart;

  const [statusFilter, setStatusFilter] = useState("PENDING");
  const [storeFilter, setStoreFilter] = useState("ALL");
  const [reviewingGroup, setReviewingGroup] = useState<EmployeeGroup | null>(null);

  const { data: timesheets, isLoading } = useQuery<EnrichedTimesheet[]>({
    queryKey: ["/api/admin/approvals", statusFilter],
    queryFn: () => fetch(`/api/admin/approvals?status=${statusFilter}`).then(r => r.json()),
    staleTime: 0,
  });

  // Filter by cycle + store
  const filtered = useMemo(() => {
    if (!timesheets) return [];
    return timesheets.filter(t => {
      const inCycle = t.date >= cycleStart && t.date <= cycleEnd;
      const inStore = storeFilter === "ALL" || t.storeId === storeFilter;
      return inCycle && inStore;
    });
  }, [timesheets, cycleStart, cycleEnd, storeFilter]);

  const stores = useMemo(() => {
    if (!timesheets) return [];
    const seen = new Map<string, { id: string; name: string }>();
    timesheets.forEach(t => { if (!seen.has(t.storeId)) seen.set(t.storeId, { id: t.storeId, name: t.storeName }); });
    return Array.from(seen.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [timesheets]);

  const employeeGroups = useMemo(() => groupByEmployee(filtered), [filtered]);

  const autoFillMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/admin/approvals/auto-fill", {
      storeId: storeFilter === "ALL" ? undefined : storeFilter,
      startDate: cycleStart,
      endDate: cycleEnd,
    }),
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/approvals"] });
      const n = data?.filled ?? 0;
      if (n === 0) {
        toast({ title: "All Caught Up", description: "No missing timesheets found for this cycle." });
      } else {
        toast({ title: `Auto-filled ${n} Timesheet${n !== 1 ? "s" : ""}`, description: "Roster entries without a timesheet are now PENDING." });
      }
    },
    onError: () => toast({ title: "Error", description: "Auto-fill failed.", variant: "destructive" }),
  });

  const totalPending = filtered.filter(t => t.status === "PENDING").length;
  const totalShifts = filtered.length;

  return (
    <AdminLayout title="Pending Approvals">
      <div className="space-y-4">

        {/* ── Top Header ───────────────────────────────────────────────────── */}
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-xl md:text-2xl font-bold tracking-tight flex items-center gap-2">
              <ClipboardCheck className="h-5 w-5 text-primary" />
              Pending Approvals
            </h2>
            <p className="text-muted-foreground text-xs mt-0.5">타임시트 검토 및 승인</p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Button
              variant="outline"
              className="h-9 gap-2 text-sm"
              onClick={() => autoFillMutation.mutate()}
              disabled={autoFillMutation.isPending}
              data-testid="button-auto-fill"
            >
              {autoFillMutation.isPending
                ? <Loader2 className="h-4 w-4 animate-spin" />
                : <Wand2 className="h-4 w-4 text-primary" />}
              <span className="hidden sm:inline">Auto-Fill from Roster</span>
              <span className="sm:hidden">Auto-Fill</span>
            </Button>
            <Button
              variant="outline"
              className="h-9 gap-2 text-sm"
              onClick={() => navigate(`/admin/weekly-payroll?weekStart=${cycleStart}`)}
              data-testid="button-goto-payroll"
            >
              <DollarSign className="h-4 w-4 text-primary" />
              <span className="hidden sm:inline">Weekly Payroll</span>
              <span className="sm:hidden">Payroll</span>
            </Button>
          </div>
        </div>

        {/* ── Cycle Navigator ───────────────────────────────────────────────── */}
        <div className="rounded-lg border border-border/40 bg-card px-3 py-2.5">
          <CycleNavigator
            cycleStart={cycleStart}
            onPrev={() => setCycleStart(s => shiftDate(s, -14))}
            onNext={() => setCycleStart(s => shiftDate(s, 14))}
            isCurrentCycle={isCurrentCycle}
            onToday={() => setCycleStart(currentCycleStart)}
          />
        </div>

        {/* ── Summary Stats ─────────────────────────────────────────────────── */}
        {!isLoading && totalShifts > 0 && (
          <div className="flex gap-3 overflow-x-auto pb-1 -mx-1 px-1 md:grid md:grid-cols-3 md:overflow-visible">
            {[
              { label: "Employees", value: employeeGroups.length, icon: <User className="h-4 w-4 text-muted-foreground" />, border: "border-border/40 bg-card", text: "text-foreground" },
              { label: "Shifts", value: totalShifts, icon: <ClipboardCheck className="h-4 w-4 text-muted-foreground" />, border: "border-border/40 bg-card", text: "text-foreground" },
              { label: "Pending", value: totalPending, icon: <Clock className="h-4 w-4 text-orange-500" />, border: "border-orange-400/40 bg-orange-500/5", text: "text-orange-600 dark:text-orange-400" },
            ].map(item => (
              <div
                key={item.label}
                className={`shrink-0 w-32 md:w-auto rounded-lg border ${item.border} px-3 py-2.5 flex items-center gap-2`}
                data-testid={`summary-${item.label.toLowerCase()}`}
              >
                {item.icon}
                <div>
                  <p className="text-[10px] text-muted-foreground leading-none mb-0.5">{item.label}</p>
                  <p className={`text-lg font-bold leading-none ${item.text}`}>{item.value}</p>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ── Filters ───────────────────────────────────────────────────────── */}
        <div className="sticky top-0 z-30 bg-background/95 backdrop-blur-sm border-b border-border/30 -mx-4 md:-mx-6 px-4 md:px-6 py-2.5 flex items-center gap-2">
          <Select value={storeFilter} onValueChange={setStoreFilter}>
            <SelectTrigger className="flex-1 min-w-0 h-9" data-testid="select-store-filter">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All Stores</SelectItem>
              {stores.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
            </SelectContent>
          </Select>

          <Select value={statusFilter} onValueChange={v => setStatusFilter(v)}>
            <SelectTrigger className="flex-1 min-w-0 h-9" data-testid="select-status-filter">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="PENDING">Pending</SelectItem>
              <SelectItem value="APPROVED">Approved</SelectItem>
              <SelectItem value="ALL">All</SelectItem>
            </SelectContent>
          </Select>

          {!isLoading && (
            <span className="text-xs text-muted-foreground whitespace-nowrap shrink-0">
              {employeeGroups.length} employee{employeeGroups.length !== 1 ? "s" : ""}
            </span>
          )}
        </div>

        {/* ── Content ──────────────────────────────────────────────────────── */}
        {isLoading ? (
          <div className="space-y-3">
            {[1, 2, 3].map(i => <Skeleton key={i} className="h-44 w-full rounded-xl" />)}
          </div>
        ) : employeeGroups.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center" data-testid="empty-state">
            <ClipboardCheck className="h-12 w-12 text-muted-foreground/30 mb-4" />
            <p className="font-semibold text-muted-foreground">
              {statusFilter === "PENDING" ? "All caught up for this cycle!" : "No timesheets found"}
            </p>
            <p className="text-sm text-muted-foreground mt-1">
              {statusFilter === "PENDING"
                ? "No pending timesheets for this payroll cycle require approval."
                : "Try changing the cycle or adjusting filters."}
            </p>
            {!isCurrentCycle && (
              <Button variant="outline" size="sm" className="mt-4" onClick={() => setCycleStart(currentCycleStart)} data-testid="button-back-to-current-cycle">
                Back to Current Cycle
              </Button>
            )}
          </div>
        ) : (
          <>
            {/* ── Mobile: Card per employee ── */}
            <div className="md:hidden space-y-3" data-testid="employee-card-list">
              {employeeGroups.map(g => (
                <EmployeeSummaryCard
                  key={g.employeeId}
                  group={g}
                  onReview={() => setReviewingGroup(g)}
                />
              ))}
            </div>

            {/* ── Desktop: Table grouped by employee ── */}
            <div className="hidden md:block">
              <Card>
                <CardContent className="p-0">
                  <div className="overflow-x-auto">
                    <table className="w-full text-left" data-testid="employee-approvals-table">
                      <thead>
                        <tr className="border-b border-border/40 bg-muted/30">
                          <th className="py-3 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Employee</th>
                          <th className="py-3 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap">Stores</th>
                          <th className="py-3 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap">Scheduled</th>
                          <th className="py-3 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap">Actual</th>
                          <th className="py-3 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Difference</th>
                          <th className="py-3 pl-2 pr-4 text-xs font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap">Shifts</th>
                          <th className="py-3 pl-2 pr-4 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {employeeGroups.map(g => {
                          const displayName = g.employeeNickname || g.employeeName.split(" ")[0];
                          return (
                            <tr
                              key={g.employeeId}
                              className="border-b border-border/20 hover-elevate"
                              data-testid={`employee-row-${g.employeeId}`}
                            >
                              <td className="py-3 px-4">
                                <div>
                                  <p className="font-semibold text-sm">{displayName}</p>
                                  {g.pendingCount > 0 && (
                                    <p className="text-[11px] text-muted-foreground">{g.pendingCount} pending</p>
                                  )}
                                </div>
                              </td>
                              <td className="py-3 px-4">
                                <div className="flex items-center gap-1 flex-wrap">
                                  {g.storeNames.map(s => (
                                    <span
                                      key={s}
                                      className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full text-white"
                                      style={{ backgroundColor: storeColor(s) }}
                                    >
                                      {s}
                                    </span>
                                  ))}
                                </div>
                              </td>
                              <td className="py-3 px-4 text-sm font-medium">
                                {g.totalScheduledHours > 0 ? fmtHours(g.totalScheduledHours) : <span className="text-muted-foreground">—</span>}
                              </td>
                              <td className="py-3 px-4 text-sm font-medium">
                                {fmtHours(g.totalActualHours)}
                              </td>
                              <td className="py-3 px-4">
                                <DiffCell diffMinutes={g.diffMinutes} />
                              </td>
                              <td className="py-3 px-4 text-sm text-muted-foreground">
                                {g.timesheets.length}
                              </td>
                              <td className="py-3 pl-2 pr-4">
                                <Button
                                  size="sm"
                                  className="gap-1.5"
                                  onClick={() => setReviewingGroup(g)}
                                  data-testid={`button-review-${g.employeeId}`}
                                >
                                  Review &amp; Approve
                                  <ArrowRight className="h-3.5 w-3.5" />
                                </Button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
            </div>
          </>
        )}
      </div>

      {/* ── Employee Review Modal ─────────────────────────────────────────────── */}
      {reviewingGroup && (
        <EmployeeReviewModal
          group={reviewingGroup}
          cycleStart={cycleStart}
          cycleEnd={cycleEnd}
          onClose={() => setReviewingGroup(null)}
          onSaved={() => setReviewingGroup(null)}
        />
      )}
    </AdminLayout>
  );
}
