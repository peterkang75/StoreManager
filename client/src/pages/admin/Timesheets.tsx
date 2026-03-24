import { useState, useMemo, useCallback, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AdminLayout } from "@/components/layouts/AdminLayout";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  History,
  ChevronLeft,
  ChevronRight,
  Loader2,
  TrendingUp,
  TrendingDown,
  User,
  X,
  RotateCcw,
  CheckCircle2,
  Lock,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { getPayrollCycleStart, getPayrollCycleEnd } from "@shared/payrollCycle";
import type { Payroll } from "@shared/schema";

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
  return new Date(dateStr + "T00:00:00").toLocaleDateString("en-AU", {
    day: "2-digit", month: "short", year: "numeric",
  });
}

function fmtDate(dateStr: string): string {
  return new Date(dateStr + "T00:00:00").toLocaleDateString("en-AU", {
    weekday: "short", day: "numeric", month: "short",
  });
}

function fmtTime(time: string | null): string {
  if (!time) return "—";
  const [h, m] = time.split(":").map(Number);
  const period = h >= 12 ? "PM" : "AM";
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${period}`;
}

function calcHours(start: string, end: string): number {
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  const diff = (eh * 60 + em) - (sh * 60 + sm);
  return diff < 0 ? (diff + 1440) / 60 : diff / 60;
}

function fmtHours(h: number): string {
  const hh = Math.floor(h);
  const mm = Math.round((h - hh) * 60);
  return mm === 0 ? `${hh}h` : `${hh}h ${mm}m`;
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
  });
  return Array.from(map.values()).sort((a, b) =>
    (a.employeeNickname || a.employeeName).localeCompare(b.employeeNickname || b.employeeName)
  );
}

// ── Diff Cell ─────────────────────────────────────────────────────────────────

function DiffCell({ diffMinutes }: { diffMinutes: number }) {
  if (diffMinutes === 0) return <span className="text-muted-foreground text-sm">—</span>;
  const isOver = diffMinutes > 0;
  const color = isOver ? "text-orange-600 dark:text-orange-400" : "text-blue-600 dark:text-blue-400";
  return (
    <span className={`text-sm font-semibold ${color}`}>
      {isOver ? <TrendingUp className="inline h-3 w-3 mr-0.5" /> : <TrendingDown className="inline h-3 w-3 mr-0.5" />}
      {fmtDiffMinutes(diffMinutes)}
    </span>
  );
}

// ── Week Header / Total row ────────────────────────────────────────────────────

function WeekHeader({ label, dateRange }: { label: string; dateRange: string }) {
  return (
    <tr className="bg-muted/40">
      <td colSpan={5} className="py-1.5 px-3">
        <span className="text-xs font-bold text-muted-foreground uppercase tracking-wider">{label}</span>
        <span className="text-[10px] text-muted-foreground ml-2">{dateRange}</span>
      </td>
    </tr>
  );
}

function WeekTotalRow({ label, hours }: { label: string; hours: number }) {
  return (
    <tr className="bg-muted/20 border-t border-border/40">
      <td colSpan={3} className="py-1.5 px-3 text-[11px] text-muted-foreground uppercase tracking-wider text-right font-semibold">
        {label}
      </td>
      <td className="py-1.5 px-2 font-bold text-sm text-foreground" colSpan={2}>
        {fmtHours(hours)}
      </td>
    </tr>
  );
}

// ── Cycle Navigator ───────────────────────────────────────────────────────────

function CycleNavigator({
  cycleStart,
  cycleEnd,
  onPrev,
  onNext,
  isCurrentCycle,
  onCurrent,
}: {
  cycleStart: string;
  cycleEnd: string;
  onPrev: () => void;
  onNext: () => void;
  isCurrentCycle: boolean;
  onCurrent: () => void;
}) {
  return (
    <div className="flex items-center gap-1.5" data-testid="cycle-navigator">
      <Button size="icon" variant="outline" onClick={onPrev} data-testid="button-cycle-prev">
        <ChevronLeft className="h-4 w-4" />
      </Button>
      <div className="flex-1 text-center min-w-0">
        <p className="text-sm font-semibold leading-tight whitespace-nowrap">
          {fmtCycleDate(cycleStart)} – {fmtCycleDate(cycleEnd)}
        </p>
        <p className="text-[10px] text-muted-foreground">14-day fortnightly cycle (AEDT)</p>
      </div>
      <Button size="icon" variant="outline" onClick={onNext} data-testid="button-cycle-next">
        <ChevronRight className="h-4 w-4" />
      </Button>
      {!isCurrentCycle && (
        <Button variant="outline" size="sm" className="shrink-0 text-xs" onClick={onCurrent} data-testid="button-cycle-current">
          Current
        </Button>
      )}
    </div>
  );
}

// ── History Modal ─────────────────────────────────────────────────────────────

function HistoryModal({
  group,
  cycleStart,
  cycleEnd,
  isPaid,
  onClose,
  onReverted,
}: {
  group: EmployeeGroup;
  cycleStart: string;
  cycleEnd: string;
  isPaid: boolean;
  onClose: () => void;
  onReverted: () => void;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const displayName = group.employeeNickname || group.employeeName.split(" ")[0];

  const [reverting, setReverting] = useState(false);

  // Prevent background scroll
  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = ""; };
  }, []);

  // Week split
  const week1End = addDays(cycleStart, 6);
  const week2Start = addDays(cycleStart, 7);
  const allSorted = [...group.timesheets].sort((a, b) => a.date.localeCompare(b.date));
  const week1Shifts = allSorted.filter(ts => ts.date <= week1End);
  const week2Shifts = allSorted.filter(ts => ts.date >= week2Start);

  const week1Hours = week1Shifts.reduce((s, ts) => s + calcHours(ts.actualStartTime, ts.actualEndTime), 0);
  const week2Hours = week2Shifts.reduce((s, ts) => s + calcHours(ts.actualStartTime, ts.actualEndTime), 0);
  const totalHours = week1Hours + week2Hours;

  const handleRevert = useCallback(async () => {
    if (!window.confirm(
      `Revert all ${group.timesheets.length} approved shifts for ${displayName} back to Pending?\n\nThey will reappear in the Approvals screen for editing.`
    )) return;
    setReverting(true);
    try {
      const ids = group.timesheets.map(ts => ts.id);
      await apiRequest("POST", "/api/admin/approvals/bulk-revert", { ids });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/approvals"] });
      toast({
        title: "Reverted to Pending",
        description: `${ids.length} shift${ids.length !== 1 ? "s" : ""} for ${displayName} moved back to Pending.`,
      });
      onReverted();
    } catch {
      toast({ title: "Revert failed", description: "Could not revert timesheets.", variant: "destructive" });
    } finally {
      setReverting(false);
    }
  }, [group, displayName, queryClient, toast, onReverted]);

  const renderShiftRow = (ts: EnrichedTimesheet) => {
    const actualH = calcHours(ts.actualStartTime, ts.actualEndTime);
    const schedH = ts.scheduledStartTime && ts.scheduledEndTime
      ? calcHours(ts.scheduledStartTime, ts.scheduledEndTime) : null;
    const shiftDiffMin = schedH !== null ? Math.round((actualH - schedH) * 60) : 0;

    return (
      <tr key={ts.id} className="border-b border-border/20 hover:bg-muted/20" data-testid={`row-history-${ts.id}`}>
        {/* Date + store dot */}
        <td className="py-1.5 px-2 whitespace-nowrap">
          <div className="flex items-center gap-1.5">
            <div
              className="h-2 w-2 rounded-full shrink-0"
              style={{ backgroundColor: storeColor(ts.storeName) }}
              title={ts.storeName}
            />
            <span className="text-xs text-foreground">{fmtDate(ts.date)}</span>
            {ts.isUnscheduled && (
              <span className="text-[9px] text-purple-600 dark:text-purple-400 italic">Unsched</span>
            )}
          </div>
        </td>

        {/* Scheduled */}
        <td className="py-1.5 px-2 whitespace-nowrap">
          {ts.scheduledStartTime && ts.scheduledEndTime
            ? <span className="text-xs text-muted-foreground">{fmtTime(ts.scheduledStartTime)}–{fmtTime(ts.scheduledEndTime)}</span>
            : <span className="text-xs text-muted-foreground/40">—</span>
          }
        </td>

        {/* Actual Start */}
        <td className="py-1.5 px-2 whitespace-nowrap">
          <span className="font-mono text-sm text-foreground">{fmtTime(ts.actualStartTime)}</span>
        </td>

        {/* Actual End */}
        <td className="py-1.5 px-2 whitespace-nowrap">
          <span className="font-mono text-sm text-foreground">{fmtTime(ts.actualEndTime)}</span>
        </td>

        {/* Hours + diff */}
        <td className="py-1.5 px-2 whitespace-nowrap">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-sm">{fmtHours(actualH)}</span>
            {schedH !== null && shiftDiffMin !== 0 && (
              <DiffCell diffMinutes={shiftDiffMin} />
            )}
          </div>
        </td>
      </tr>
    );
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/50"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="bg-background w-full max-w-2xl rounded-t-2xl md:rounded-xl flex flex-col"
        style={{ maxHeight: "90dvh" }}
      >
        {/* Drag handle (mobile) */}
        <div className="md:hidden flex justify-center pt-3 pb-1 shrink-0">
          <div className="w-10 h-1 rounded-full bg-muted-foreground/30" />
        </div>

        {/* Header */}
        <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-border/40 shrink-0">
          <div>
            <h2 className="font-bold text-base flex items-center gap-2">
              <User className="h-4 w-4 text-primary" />
              {displayName}
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              {fmtCycleDate(cycleStart)} – {fmtCycleDate(cycleEnd)}
              {" · "}
              {group.timesheets.length} shift{group.timesheets.length !== 1 ? "s" : ""}
              {" · "}
              <span className="font-semibold text-foreground">{fmtHours(totalHours)}</span> total
            </p>
            {isPaid && (
              <div className="flex items-center gap-1 mt-1.5 text-xs text-amber-600 dark:text-amber-400 font-medium">
                <Lock className="h-3 w-3 shrink-0" />
                Payroll paid — record is locked
              </div>
            )}
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {!isPaid && (
              <Button
                size="sm"
                variant="outline"
                onClick={handleRevert}
                disabled={reverting}
                className="text-destructive border-destructive/40 hover:bg-destructive/5"
                data-testid="button-revert-pending"
              >
                {reverting
                  ? <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />Reverting…</>
                  : <><RotateCcw className="h-3.5 w-3.5 mr-1.5" />Revert to Pending</>
                }
              </Button>
            )}
            <Button size="icon" variant="ghost" onClick={onClose} data-testid="button-modal-close">
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Read-only label */}
        <div className="px-5 py-1.5 bg-muted/30 border-b border-border/20 shrink-0">
          <p className="text-[10px] text-muted-foreground italic">
            승인 완료 기록 — 수정하려면 Revert to Pending을 사용하세요
          </p>
        </div>

        {/* Scrollable table */}
        <div className="overflow-y-auto flex-1">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm" data-testid="history-shifts-table">
              <thead className="sticky top-0 bg-muted/80 backdrop-blur-sm z-10">
                <tr className="border-b border-border/40">
                  <th className="py-2 px-2 text-xs font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap">Date</th>
                  <th className="py-2 px-2 text-xs font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap">Scheduled</th>
                  <th className="py-2 px-2 text-xs font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap">Start</th>
                  <th className="py-2 px-2 text-xs font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap">End</th>
                  <th className="py-2 px-2 text-xs font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap">Hours</th>
                </tr>
              </thead>

              {/* Week 1 */}
              <tbody>
                <WeekHeader
                  label="Week 1"
                  dateRange={`${fmtCycleDate(cycleStart)} – ${fmtCycleDate(week1End)}`}
                />
                {week1Shifts.length > 0
                  ? week1Shifts.map(renderShiftRow)
                  : (
                    <tr>
                      <td colSpan={5} className="py-3 px-4 text-sm text-muted-foreground italic">No shifts this week</td>
                    </tr>
                  )
                }
                <WeekTotalRow label="Week 1 Total" hours={week1Hours} />
              </tbody>

              {/* Week 2 */}
              <tbody>
                <WeekHeader
                  label="Week 2"
                  dateRange={`${fmtCycleDate(week2Start)} – ${fmtCycleDate(cycleEnd)}`}
                />
                {week2Shifts.length > 0
                  ? week2Shifts.map(renderShiftRow)
                  : (
                    <tr>
                      <td colSpan={5} className="py-3 px-4 text-sm text-muted-foreground italic">No shifts this week</td>
                    </tr>
                  )
                }
                <WeekTotalRow label="Week 2 Total" hours={week2Hours} />
              </tbody>
            </table>
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-between items-center px-5 py-3 border-t border-border/40 shrink-0 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
          <span className="text-xs text-muted-foreground">
            {group.storeNames.join(" · ")}
          </span>
          <Button variant="outline" className="min-h-[44px]" onClick={onClose} data-testid="button-modal-close-footer">
            Close
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────────

export function AdminTimesheets() {
  const today = getAEDTToday();
  const currentCycleStart = getPayrollCycleStart(today);
  const [cycleStart, setCycleStart] = useState(currentCycleStart);
  const [selectedGroup, setSelectedGroup] = useState<EmployeeGroup | null>(null);

  const cycleEnd = getPayrollCycleEnd(cycleStart);
  const isCurrentCycle = cycleStart === currentCycleStart;

  // Fetch all timesheets (any status) — we filter APPROVED client-side
  const { data: allRows = [], isLoading } = useQuery<EnrichedTimesheet[]>({
    queryKey: ["/api/admin/approvals"],
    queryFn: () => fetch("/api/admin/approvals?status=ALL").then(r => r.json()),
    staleTime: 0,
  });

  // Fetch payrolls for this cycle to detect PAID employees
  const { data: cyclePayrolls = [] } = useQuery<Payroll[]>({
    queryKey: ["/api/payrolls", "cycle", cycleStart],
    queryFn: () => fetch(`/api/payrolls?period_start=${cycleStart}`).then(r => r.json()),
    staleTime: 30_000,
  });

  // Filter: APPROVED only, within cycle dates
  const approvedInCycle = useMemo(() =>
    allRows.filter(r => r.status === "APPROVED" && r.date >= cycleStart && r.date <= cycleEnd),
    [allRows, cycleStart, cycleEnd]
  );

  const groups = useMemo(() => groupByEmployee(approvedInCycle), [approvedInCycle]);

  // PAID map: employeeId → boolean
  const paidEmployeeIds = useMemo(() => {
    const set = new Set<string>();
    cyclePayrolls.forEach(p => {
      if (
        p.isBankTransferDone &&
        p.periodStart <= cycleStart &&
        p.periodEnd >= cycleStart
      ) {
        set.add(p.employeeId);
      }
    });
    return set;
  }, [cyclePayrolls, cycleStart]);

  // Summary stats
  const totalHours = useMemo(() =>
    groups.reduce((s, g) => s + g.totalActualHours, 0),
    [groups]
  );
  const paidCount = useMemo(() =>
    groups.filter(g => paidEmployeeIds.has(g.employeeId)).length,
    [groups, paidEmployeeIds]
  );

  const handleReverted = useCallback(() => {
    setSelectedGroup(null);
  }, []);

  return (
    <AdminLayout title="Attendance History">
      <div className="space-y-4">

        {/* ── Page Header ───────────────────────────────────────────────── */}
        <div>
          <h2 className="text-xl md:text-2xl font-bold tracking-tight flex items-center gap-2">
            <History className="h-5 w-5 text-primary" />
            Attendance History
          </h2>
          <p className="text-muted-foreground text-xs mt-0.5">승인 완료된 근무 기록 — 포트나이트 주기별</p>
        </div>

        {/* ── Cycle Navigator ───────────────────────────────────────────── */}
        <div className="rounded-lg border border-border/40 bg-card px-3 py-2.5">
          <CycleNavigator
            cycleStart={cycleStart}
            cycleEnd={cycleEnd}
            onPrev={() => setCycleStart(s => addDays(s, -14))}
            onNext={() => setCycleStart(s => addDays(s, 14))}
            isCurrentCycle={isCurrentCycle}
            onCurrent={() => setCycleStart(currentCycleStart)}
          />
        </div>

        {/* ── Summary Stats ─────────────────────────────────────────────── */}
        {isLoading ? (
          <div className="grid grid-cols-3 gap-3">
            {[1, 2, 3].map(i => <Skeleton key={i} className="h-16 rounded-lg" />)}
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: "Employees", value: groups.length, color: "text-foreground" },
              { label: "Total Hours", value: fmtHours(totalHours), color: "text-foreground" },
              { label: "Payroll Paid", value: paidCount, color: "text-green-600 dark:text-green-400" },
            ].map(item => (
              <div
                key={item.label}
                className="rounded-lg border border-border/30 bg-card px-4 py-2.5"
                data-testid={`stat-${item.label.toLowerCase().replace(/\s+/g, "-")}`}
              >
                <p className="text-[11px] text-muted-foreground">{item.label}</p>
                <p className={`text-2xl font-black leading-tight ${item.color}`}>{item.value}</p>
              </div>
            ))}
          </div>
        )}

        {/* ── Employee List ──────────────────────────────────────────────── */}
        {isLoading ? (
          <div className="space-y-2">
            {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-16 w-full rounded-lg" />)}
          </div>
        ) : groups.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <CheckCircle2 className="h-12 w-12 text-muted-foreground/30 mb-4" />
            <p className="font-semibold text-muted-foreground">No approved records</p>
            <p className="text-sm text-muted-foreground mt-1">
              No approved timesheets found for this cycle.
            </p>
          </div>
        ) : (
          <>
            {/* Desktop Table */}
            <div className="hidden md:block rounded-lg border border-border/40 overflow-hidden bg-card" data-testid="history-employee-table">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-muted/30 border-b border-border/40">
                    <th className="py-2.5 px-4 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Employee</th>
                    <th className="py-2.5 px-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Stores</th>
                    <th className="py-2.5 px-3 text-right text-xs font-semibold text-muted-foreground uppercase tracking-wide">Scheduled</th>
                    <th className="py-2.5 px-3 text-right text-xs font-semibold text-muted-foreground uppercase tracking-wide">Actual</th>
                    <th className="py-2.5 px-3 text-right text-xs font-semibold text-muted-foreground uppercase tracking-wide">Diff</th>
                    <th className="py-2.5 px-3 text-center text-xs font-semibold text-muted-foreground uppercase tracking-wide">Status</th>
                    <th className="py-2.5 px-4 w-8" />
                  </tr>
                </thead>
                <tbody>
                  {groups.map(group => {
                    const isPaid = paidEmployeeIds.has(group.employeeId);
                    const displayName = group.employeeNickname || group.employeeName.split(" ")[0];
                    return (
                      <tr
                        key={group.employeeId}
                        className="border-b border-border/20 cursor-pointer transition-colors hover-elevate"
                        onClick={() => setSelectedGroup(group)}
                        data-testid={`row-history-employee-${group.employeeId}`}
                      >
                        <td className="py-3 px-4">
                          <div className="font-semibold text-sm">{displayName}</div>
                          <div className="text-[11px] text-muted-foreground">{group.employeeName}</div>
                        </td>
                        <td className="py-3 px-3">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            {group.storeNames.map(s => (
                              <div key={s} className="flex items-center gap-1">
                                <div className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: storeColor(s) }} />
                                <span className="text-xs text-muted-foreground">{s}</span>
                              </div>
                            ))}
                          </div>
                        </td>
                        <td className="py-3 px-3 text-right">
                          {group.totalScheduledHours > 0
                            ? <span className="text-sm text-muted-foreground">{fmtHours(group.totalScheduledHours)}</span>
                            : <span className="text-muted-foreground/40 text-sm">—</span>
                          }
                        </td>
                        <td className="py-3 px-3 text-right">
                          <span className="text-sm font-semibold">{fmtHours(group.totalActualHours)}</span>
                        </td>
                        <td className="py-3 px-3 text-right">
                          <DiffCell diffMinutes={group.diffMinutes} />
                        </td>
                        <td className="py-3 px-3 text-center">
                          {isPaid
                            ? (
                              <span className="inline-flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400 font-medium">
                                <Lock className="h-3 w-3" /> Paid
                              </span>
                            )
                            : (
                              <span className="inline-flex items-center gap-1 text-xs text-green-600 dark:text-green-400 font-medium">
                                <CheckCircle2 className="h-3 w-3" /> Approved
                              </span>
                            )
                          }
                        </td>
                        <td className="py-3 px-4">
                          <ChevronRight className="h-4 w-4 text-muted-foreground/40" />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Mobile Card List */}
            <div className="md:hidden space-y-2.5" data-testid="history-mobile-cards">
              {groups.map(group => {
                const isPaid = paidEmployeeIds.has(group.employeeId);
                const displayName = group.employeeNickname || group.employeeName.split(" ")[0];
                return (
                  <div
                    key={group.employeeId}
                    className="rounded-xl border border-border/40 bg-card px-4 py-3 cursor-pointer transition-colors hover-elevate active-elevate-2"
                    onClick={() => setSelectedGroup(group)}
                    data-testid={`card-history-employee-${group.employeeId}`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-bold text-sm">{displayName}</span>
                          <div className="flex items-center gap-1.5">
                            {group.storeNames.map(s => (
                              <div key={s} className="flex items-center gap-1">
                                <div className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: storeColor(s) }} />
                                <span className="text-[11px] text-muted-foreground">{s}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                        <div className="flex items-center gap-3 mt-1 flex-wrap">
                          <span className="text-xs text-muted-foreground">
                            Actual: <span className="font-semibold text-foreground">{fmtHours(group.totalActualHours)}</span>
                          </span>
                          {group.totalScheduledHours > 0 && (
                            <span className="text-xs text-muted-foreground">
                              Scheduled: <span className="font-semibold text-foreground">{fmtHours(group.totalScheduledHours)}</span>
                            </span>
                          )}
                          {group.diffMinutes !== 0 && (
                            <DiffCell diffMinutes={group.diffMinutes} />
                          )}
                        </div>
                        {isPaid && (
                          <div className="flex items-center gap-1 mt-1 text-xs text-amber-600 dark:text-amber-400 font-medium">
                            <Lock className="h-3 w-3" /> Payroll paid
                          </div>
                        )}
                      </div>
                      <ChevronRight className="h-4 w-4 text-muted-foreground/40 shrink-0" />
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>

      {/* Employee History Modal */}
      {selectedGroup && (
        <HistoryModal
          group={selectedGroup}
          cycleStart={cycleStart}
          cycleEnd={cycleEnd}
          isPaid={paidEmployeeIds.has(selectedGroup.employeeId)}
          onClose={() => setSelectedGroup(null)}
          onReverted={handleReverted}
        />
      )}
    </AdminLayout>
  );
}
