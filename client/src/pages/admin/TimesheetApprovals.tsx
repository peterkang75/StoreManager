import { useState, useMemo, useCallback, useRef, useEffect } from "react";
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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
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
  Trash2,
  Check,
} from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { getPayrollCycleStart, getPayrollCycleEnd, shiftDate } from "@shared/payrollCycle";
import { useAdminRole } from "@/contexts/AdminRoleContext";

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

import { STORE_COLORS, storeColorFor as storeColor } from "@shared/storeColors";

// ── Group by employee ──────────────────────────────────────────────────────────

function groupByEmployee(timesheets: EnrichedTimesheet[]): EmployeeGroup[] {
  const map = new Map<string, EmployeeGroup>();
  // REJECTED are tombstones — exclude them from all list calculations
  timesheets.filter(ts => ts.status !== "REJECTED").forEach(ts => {
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

  // Local copy of timesheets so we can append manager-added shifts without refetching
  const [localTimesheets, setLocalTimesheets] = useState<EnrichedTimesheet[]>(group.timesheets);

  // Unique store options derived from existing timesheets
  const storeOptions = useMemo(() => {
    const map = new Map<string, string>();
    localTimesheets.forEach(ts => map.set(ts.storeId, ts.storeName));
    return Array.from(map.entries()).map(([storeId, storeName]) => ({ storeId, storeName }));
  }, [localTimesheets]);

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

  // Delete-in-progress set
  const [deletingIds, setDeletingIds] = useState<Set<string>>(new Set());

  // Add missing shift form state
  const [showAddForm, setShowAddForm] = useState(false);
  const [addForm, setAddForm] = useState(() => ({
    date: cycleStart,
    storeId: group.timesheets[0]?.storeId ?? "",
    start: "09:00",
    end: "17:00",
  }));
  const [addingSaving, setAddingSaving] = useState(false);

  const pendingShifts = localTimesheets.filter(ts => ts.status === "PENDING");

  // Live-computed totals from edits — exclude REJECTED tombstones
  const liveActualHours = localTimesheets.reduce((sum, ts) => {
    if (ts.status === "REJECTED") return sum;
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

  // Add a manager-added missing shift
  const handleAddShift = async () => {
    if (!addForm.date || !addForm.storeId || !addForm.start || !addForm.end) {
      toast({ title: "Fill in all fields", variant: "destructive" }); return;
    }
    setAddingSaving(true);
    try {
      const res = await apiRequest("POST", "/api/admin/approvals/add-shift", {
        storeId: addForm.storeId,
        employeeId: group.employeeId,
        date: addForm.date,
        actualStartTime: addForm.start,
        actualEndTime: addForm.end,
      });
      const data = await res.json();
      const store = storeOptions.find(s => s.storeId === addForm.storeId);
      const newTs: EnrichedTimesheet = {
        id: data.id,
        date: data.date,
        storeId: data.storeId,
        storeName: store?.storeName ?? "",
        storeCode: "",
        employeeId: group.employeeId,
        employeeName: group.employeeName,
        employeeNickname: group.employeeNickname,
        actualStartTime: data.actualStartTime,
        actualEndTime: data.actualEndTime,
        scheduledStartTime: null,
        scheduledEndTime: null,
        status: "APPROVED",
        adjustmentReason: "Added by manager",
        isUnscheduled: true,
        createdAt: data.createdAt,
      };
      setLocalTimesheets(prev => [...prev, newTs]);
      setEdits(prev => ({ ...prev, [newTs.id]: { start: newTs.actualStartTime, end: newTs.actualEndTime } }));
      setShowAddForm(false);
      setAddForm(prev => ({ ...prev, date: cycleStart, start: "09:00", end: "17:00" }));
      queryClient.invalidateQueries({ queryKey: ["/api/admin/approvals"] });
      toast({ title: "Shift Added", description: `New shift on ${fmtDate(data.date)} has been recorded.` });
    } catch {
      toast({ title: "Failed to add shift", description: "Please try again.", variant: "destructive" });
    } finally {
      setAddingSaving(false);
    }
  };

  // Delete a single shift — asks for confirmation, removes from DB and local state
  const handleDeleteShift = useCallback(async (tsId: string, date: string) => {
    if (!window.confirm(`Mark shift on ${fmtDate(date)} as absent (no hours paid)?\n\nThe record will be kept as a tombstone so Auto-Fill won't recreate it.`)) return;
    setDeletingIds(prev => new Set(prev).add(tsId));
    try {
      await apiRequest("PATCH", `/api/admin/approvals/${tsId}/reject`);
      // Soft delete: update status to REJECTED in local state (keeps the tombstone)
      setLocalTimesheets(prev => prev.map(ts => ts.id === tsId ? { ...ts, status: "REJECTED" } : ts));
      setEdits(prev => { const n = { ...prev }; delete n[tsId]; return n; });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/approvals"] });
      toast({ title: "Marked as absent", description: `Shift on ${fmtDate(date)} — 0 hours will be paid.` });
    } catch {
      toast({ title: "Failed", description: "Could not mark this shift as absent.", variant: "destructive" });
    } finally {
      setDeletingIds(prev => { const n = new Set(prev); n.delete(tsId); return n; });
    }
  }, [queryClient, toast]);

  // Split into two 7-day weeks — exclude REJECTED tombstones from display
  const activeTimesheets = localTimesheets.filter(ts => ts.status !== "REJECTED");
  const allSorted = [...activeTimesheets].sort((a, b) => a.date.localeCompare(b.date));
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
    const isDeleting = deletingIds.has(ts.id);

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
          className="font-mono h-7 text-xs px-1 w-[120px] shrink-0"
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

        {/* Actions: save indicator + delete */}
        <td className="py-1.5 px-1 w-16">
          <div className="flex items-center justify-end gap-0.5">
            {isSaving && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground shrink-0" />}
            {!isSaving && justSaved && <CheckCircle2 className="h-3.5 w-3.5 text-green-500 shrink-0" />}
            {!isSaving && isApproved && !justSaved && <CheckCircle2 className="h-3.5 w-3.5 text-green-500/40 shrink-0" />}
            <button
              type="button"
              onClick={() => handleDeleteShift(ts.id, ts.date)}
              disabled={isDeleting || isSaving}
              className="h-6 w-6 flex items-center justify-center rounded text-muted-foreground/30 hover:text-destructive hover:bg-destructive/10 transition-colors shrink-0 ml-0.5"
              data-testid={`button-delete-${ts.id}`}
            >
              {isDeleting
                ? <Loader2 className="h-3 w-3 animate-spin" />
                : <Trash2 className="h-3 w-3" />
              }
            </button>
          </div>
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
          <div className="flex items-center gap-2 shrink-0">
            {pendingShifts.length > 0 ? (
              <Button
                size="sm"
                variant="default"
                onClick={handleApproveAll}
                disabled={approving || savingIds.size > 0}
                data-testid="button-approve-all"
              >
                {approving
                  ? <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />Approving…</>
                  : savingIds.size > 0
                  ? <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />Saving…</>
                  : <><Check className="h-3.5 w-3.5 mr-1.5" />Approve All</>
                }
              </Button>
            ) : (
              <span className="text-xs text-green-600 dark:text-green-400 flex items-center gap-1 font-medium whitespace-nowrap">
                <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                All approved
              </span>
            )}
            <Button size="icon" variant="ghost" onClick={onClose} data-testid="button-modal-close">
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Scrollable body */}
        <div className="overflow-y-auto flex-1">

          {/* ── Mobile: card-per-shift layout ── */}
          <div className="md:hidden">
            {[
              { label: "Week 1", shifts: week1Shifts, hours: week1Hours, start: cycleStart, end: week1End },
              { label: "Week 2", shifts: week2Shifts, hours: week2Hours, start: week2Start, end: cycleEnd },
            ].map(week => (
              <div key={week.label}>
                <div className="px-4 py-2 bg-muted/40 border-y border-border/30 flex items-center justify-between">
                  <span className="text-xs font-bold uppercase tracking-widest text-muted-foreground">{week.label}</span>
                  <span className="text-xs text-muted-foreground">{fmtCycleDate(week.start)} – {fmtCycleDate(week.end)}</span>
                </div>
                {week.shifts.length > 0 ? week.shifts.map(ts => {
                  const e = edits[ts.id];
                  const actualH = e ? calcHours(e.start, e.end) : 0;
                  const schedH = ts.scheduledStartTime && ts.scheduledEndTime
                    ? calcHours(ts.scheduledStartTime, ts.scheduledEndTime) : null;
                  const shiftDiffMin = schedH !== null ? Math.round((actualH - schedH) * 60) : 0;
                  const isPending = ts.status === "PENDING";
                  const isApproved = ts.status === "APPROVED";
                  const isSaving = savingIds.has(ts.id);
                  const justSaved = savedIds.has(ts.id);
                  const isDeleting = deletingIds.has(ts.id);
                  return (
                    <div key={ts.id} className={`px-4 py-3 border-b border-border/10 ${isApproved ? "opacity-60" : ""}`} data-testid={`review-card-${ts.id}`}>
                      <div className="flex items-start justify-between mb-1.5">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-semibold text-sm">{fmtDate(ts.date)}</span>
                          {isMultiStore && (
                            <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full text-white shrink-0" style={{ backgroundColor: storeColor(ts.storeName) }}>{ts.storeName}</span>
                          )}
                          <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${isPending ? "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400" : "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"}`}>
                            {isPending ? "Pending" : "Approved"}
                          </span>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          {isSaving && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
                          {!isSaving && justSaved && <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />}
                          {!isSaving && isApproved && !justSaved && <CheckCircle2 className="h-3.5 w-3.5 text-green-500/40" />}
                          <button
                            type="button"
                            onClick={() => handleDeleteShift(ts.id, ts.date)}
                            disabled={isDeleting || isSaving}
                            className="h-7 w-7 flex items-center justify-center rounded text-muted-foreground/30 hover:text-destructive hover:bg-destructive/10 transition-colors"
                            data-testid={`button-delete-${ts.id}`}
                          >
                            {isDeleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                          </button>
                        </div>
                      </div>
                      <p className="text-xs text-muted-foreground mb-2">
                        {ts.scheduledStartTime && ts.scheduledEndTime
                          ? <>Sched: {fmtTime(ts.scheduledStartTime)} – {fmtTime(ts.scheduledEndTime)}</>
                          : <span className="text-purple-600 dark:text-purple-400 font-medium">Unscheduled</span>}
                      </p>
                      {isPending ? (
                        <div className="grid grid-cols-2 gap-2 mb-2">
                          {(["start", "end"] as const).map(field => (
                            <div key={field}>
                              <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1">{field === "start" ? "Start" : "End"}</p>
                              <div className="flex items-center gap-0.5">
                                <button type="button" onClick={() => handleAdjust(ts.id, field, -15)} className="h-8 w-7 flex items-center justify-center rounded text-muted-foreground hover-elevate active-elevate-2 shrink-0" data-testid={`button-${field}-minus-${ts.id}`}>
                                  <Minus className="h-3 w-3" />
                                </button>
                                <Input
                                  type="time"
                                  value={e?.[field] ?? (field === "start" ? ts.actualStartTime : ts.actualEndTime)}
                                  onChange={ev => setEdits(prev => ({ ...prev, [ts.id]: { ...prev[ts.id], [field]: ev.target.value } }))}
                                  onBlur={() => autoSave(ts.id)}
                                  className="font-mono h-8 text-xs px-1 flex-1 min-w-0"
                                  data-testid={`input-${field}-${ts.id}`}
                                />
                                <button type="button" onClick={() => handleAdjust(ts.id, field, 15)} className="h-8 w-7 flex items-center justify-center rounded text-muted-foreground hover-elevate active-elevate-2 shrink-0" data-testid={`button-${field}-plus-${ts.id}`}>
                                  <Plus className="h-3 w-3" />
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-sm font-mono text-muted-foreground mb-2">{fmtTime(ts.actualStartTime)} – {fmtTime(ts.actualEndTime)}</p>
                      )}
                      <div className="flex items-center gap-3">
                        <span className="font-bold text-sm">{fmtHours(actualH)}</span>
                        {schedH !== null && <DiffCell diffMinutes={shiftDiffMin} />}
                      </div>
                    </div>
                  );
                }) : (
                  <p className="px-4 py-3 text-sm text-muted-foreground italic">No shifts this week</p>
                )}
                <div className="px-4 py-2 bg-muted/20 border-b border-border/20 flex items-center justify-end gap-2">
                  <span className="text-xs text-muted-foreground">{week.label} Total:</span>
                  <span className="text-sm font-bold">{fmtHours(week.hours)}</span>
                </div>
              </div>
            ))}

            {/* Mobile: Add Missing Shift */}
            {showAddForm ? (() => {
              const previewHours = calcHours(addForm.start, addForm.end);
              return (
                <div className="px-4 py-4 bg-blue-50/30 dark:bg-blue-950/10 border-t border-blue-200/60 dark:border-blue-800/40">
                  <p className="text-xs font-bold uppercase tracking-widest text-blue-700 dark:text-blue-400 mb-3">New Shift</p>
                  <div className="grid grid-cols-2 gap-3 mb-3">
                    <div>
                      <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1">Date</p>
                      <Input type="date" min={cycleStart} max={cycleEnd} value={addForm.date} onChange={e => setAddForm(prev => ({ ...prev, date: e.target.value }))} className="h-9 text-sm" data-testid="input-addshift-date-mobile" />
                    </div>
                    <div>
                      <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1">Store</p>
                      {storeOptions.length > 1 ? (
                        <Select value={addForm.storeId} onValueChange={v => setAddForm(prev => ({ ...prev, storeId: v }))}>
                          <SelectTrigger className="h-9 text-sm" data-testid="select-addshift-store-mobile"><SelectValue /></SelectTrigger>
                          <SelectContent>{storeOptions.map(s => <SelectItem key={s.storeId} value={s.storeId}>{s.storeName}</SelectItem>)}</SelectContent>
                        </Select>
                      ) : (
                        <p className="text-sm font-medium py-2">{storeOptions[0]?.storeName}</p>
                      )}
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3 mb-3">
                    {(["start", "end"] as const).map(field => (
                      <div key={field}>
                        <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1">{field === "start" ? "Start" : "End"}</p>
                        <div className="flex items-center gap-0.5">
                          <button type="button" onClick={() => setAddForm(prev => ({ ...prev, [field]: adjustTime(prev[field], -15) }))} className="h-9 w-8 flex items-center justify-center rounded text-muted-foreground hover-elevate active-elevate-2 shrink-0"><Minus className="h-3.5 w-3.5" /></button>
                          <Input type="time" value={addForm[field]} onChange={e => setAddForm(prev => ({ ...prev, [field]: e.target.value }))} className="font-mono h-9 text-sm px-1 flex-1 min-w-0" data-testid={`input-addshift-${field}-mobile`} />
                          <button type="button" onClick={() => setAddForm(prev => ({ ...prev, [field]: adjustTime(prev[field], 15) }))} className="h-9 w-8 flex items-center justify-center rounded text-muted-foreground hover-elevate active-elevate-2 shrink-0"><Plus className="h-3.5 w-3.5" /></button>
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <Button size="sm" className="gap-1.5 bg-blue-600 text-white" onClick={handleAddShift} disabled={addingSaving} data-testid="button-addshift-save">
                      {addingSaving ? <><Loader2 className="h-3.5 w-3.5 animate-spin" />Saving…</> : <><CheckCircle2 className="h-3.5 w-3.5" />Save Shift</>}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setShowAddForm(false)} data-testid="button-addshift-cancel">Cancel</Button>
                    <span className="text-xs text-muted-foreground">{fmtHours(previewHours)} · Approved</span>
                  </div>
                </div>
              );
            })() : (
              <div className="px-4 py-2 border-t border-border/10">
                <button type="button" className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors hover-elevate rounded px-2 py-1" onClick={() => setShowAddForm(true)} data-testid="button-add-missing-shift">
                  <Plus className="h-3.5 w-3.5" />
                  Add Missing Shift
                </button>
              </div>
            )}
          </div>

          {/* ── Desktop: existing scrollable table ── */}
          <div className="hidden md:block overflow-x-auto">
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

              {/* ── Add Missing Shift Form ── */}
              {showAddForm && (() => {
                const previewHours = calcHours(addForm.start, addForm.end);
                return (
                  <tbody>
                    <tr>
                      <td colSpan={7} className="py-1.5 px-3 bg-blue-50/60 dark:bg-blue-950/25 border-y border-blue-200/60 dark:border-blue-800/40">
                        <span className="text-xs font-bold uppercase tracking-widest text-blue-700 dark:text-blue-400">
                          New Shift
                        </span>
                      </td>
                    </tr>
                    <tr className="bg-blue-50/30 dark:bg-blue-950/10 border-b border-border/20">
                      <td className="py-1.5 px-2">
                        <Input type="date" min={cycleStart} max={cycleEnd} value={addForm.date} onChange={e => setAddForm(prev => ({ ...prev, date: e.target.value }))} className="h-7 text-xs px-1.5 w-[130px]" data-testid="input-addshift-date" />
                      </td>
                      <td className="py-1.5 px-2">
                        {storeOptions.length > 1 ? (
                          <Select value={addForm.storeId} onValueChange={v => setAddForm(prev => ({ ...prev, storeId: v }))}>
                            <SelectTrigger className="h-7 text-xs w-[100px]" data-testid="select-addshift-store"><SelectValue /></SelectTrigger>
                            <SelectContent>{storeOptions.map(s => <SelectItem key={s.storeId} value={s.storeId}>{s.storeName}</SelectItem>)}</SelectContent>
                          </Select>
                        ) : (
                          <span className="text-xs text-muted-foreground px-1">{storeOptions[0]?.storeName}</span>
                        )}
                      </td>
                      <td className="py-1 px-1">
                        <div className="flex items-center gap-0.5">
                          <button type="button" onClick={() => setAddForm(prev => ({ ...prev, start: adjustTime(prev.start, -15) }))} className="h-7 w-6 flex items-center justify-center rounded text-muted-foreground hover-elevate active-elevate-2 shrink-0"><Minus className="h-3 w-3" /></button>
                          <Input type="time" value={addForm.start} onChange={e => setAddForm(prev => ({ ...prev, start: e.target.value }))} className="font-mono h-7 text-xs px-1 w-[120px] shrink-0" data-testid="input-addshift-start" />
                          <button type="button" onClick={() => setAddForm(prev => ({ ...prev, start: adjustTime(prev.start, 15) }))} className="h-7 w-6 flex items-center justify-center rounded text-muted-foreground hover-elevate active-elevate-2 shrink-0"><Plus className="h-3 w-3" /></button>
                        </div>
                      </td>
                      <td className="py-1 px-1">
                        <div className="flex items-center gap-0.5">
                          <button type="button" onClick={() => setAddForm(prev => ({ ...prev, end: adjustTime(prev.end, -15) }))} className="h-7 w-6 flex items-center justify-center rounded text-muted-foreground hover-elevate active-elevate-2 shrink-0"><Minus className="h-3 w-3" /></button>
                          <Input type="time" value={addForm.end} onChange={e => setAddForm(prev => ({ ...prev, end: e.target.value }))} className="font-mono h-7 text-xs px-1 w-[120px] shrink-0" data-testid="input-addshift-end" />
                          <button type="button" onClick={() => setAddForm(prev => ({ ...prev, end: adjustTime(prev.end, 15) }))} className="h-7 w-6 flex items-center justify-center rounded text-muted-foreground hover-elevate active-elevate-2 shrink-0"><Plus className="h-3 w-3" /></button>
                        </div>
                      </td>
                      <td className="py-1.5 px-2 text-xs text-muted-foreground">—</td>
                      <td className="py-1.5 px-2 font-semibold text-sm">{fmtHours(previewHours)}</td>
                      <td />
                    </tr>
                    <tr className="bg-blue-50/20 dark:bg-blue-950/10">
                      <td colSpan={7} className="py-2 px-3">
                        <div className="flex items-center gap-2">
                          <Button size="sm" className="h-8 gap-1.5 bg-blue-600 text-white" onClick={handleAddShift} disabled={addingSaving} data-testid="button-addshift-save">
                            {addingSaving ? <><Loader2 className="h-3.5 w-3.5 animate-spin" />Saving…</> : <><CheckCircle2 className="h-3.5 w-3.5" />Save Shift</>}
                          </Button>
                          <Button size="sm" variant="ghost" className="h-8" onClick={() => setShowAddForm(false)} data-testid="button-addshift-cancel">Cancel</Button>
                          <span className="text-xs text-muted-foreground ml-1">Status: Approved · Unscheduled</span>
                        </div>
                      </td>
                    </tr>
                  </tbody>
                );
              })()}

              {/* ── "Add Missing Shift" trigger row ── */}
              {!showAddForm && (
                <tbody>
                  <tr>
                    <td colSpan={7} className="py-2 px-3">
                      <button type="button" className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors hover-elevate rounded px-2 py-1" onClick={() => setShowAddForm(true)} data-testid="button-add-missing-shift">
                        <Plus className="h-3.5 w-3.5" />
                        Add Missing Shift
                      </button>
                    </td>
                  </tr>
                </tbody>
              )}
            </table>
          </div>
        </div>

        {/* Pinned footer */}
        <div className="flex px-5 py-3 border-t border-border/40 shrink-0 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
          <Button variant="outline" className="min-h-[44px]" onClick={onClose} data-testid="button-modal-cancel">
            Close
          </Button>
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
      className="bg-card rounded-xl border border-border/40 shadow-sm p-4 flex flex-col gap-3 cursor-pointer hover-elevate transition-colors"
      onClick={onReview}
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
        <div className="flex items-center gap-1.5 shrink-0">
          <span className="text-xs font-medium text-muted-foreground bg-muted/60 px-2 py-1 rounded-md">
            {group.pendingCount} pending
          </span>
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
        </div>
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
    </div>
  );
}

// ── Standalone Add Shift Dialog ────────────────────────────────────────────────

type EmpOption = { id: string; firstName: string; lastName: string; nickname: string | null; status: string };
type StoreOption = { id: string; name: string };

function calcHoursPreview(start: string, end: string): string {
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  const total = (eh * 60 + em) - (sh * 60 + sm);
  if (isNaN(total) || total <= 0) return "—";
  const h = Math.floor(total / 60);
  const m = total % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

function StandaloneAddShiftDialog({
  open,
  onOpenChange,
  today,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  today: string;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const dropdownRef = useRef<HTMLDivElement>(null);

  const { data: rawEmployees = [] } = useQuery<EmpOption[]>({ queryKey: ["/api/employees"] });
  const { data: rawStores = [] } = useQuery<StoreOption[]>({ queryKey: ["/api/stores"] });

  const [empQuery, setEmpQuery] = useState("");
  const [selectedEmp, setSelectedEmp] = useState<EmpOption | null>(null);
  const [showDrop, setShowDrop] = useState(false);
  const [storeId, setStoreId] = useState("");
  const [date, setDate] = useState(today);
  const [startTime, setStartTime] = useState("09:00");
  const [endTime, setEndTime] = useState("17:00");
  const [saving, setSaving] = useState(false);

  // reset on open
  useEffect(() => {
    if (open) {
      setEmpQuery(""); setSelectedEmp(null); setShowDrop(false);
      setStoreId(""); setDate(today); setStartTime("09:00"); setEndTime("17:00");
    }
  }, [open, today]);

  // close dropdown when clicking outside
  useEffect(() => {
    function handle(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowDrop(false);
      }
    }
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, []);

  const filteredEmps = useMemo(() => {
    const q = empQuery.trim().toLowerCase();
    if (!q) return [];
    return rawEmployees.filter(e => {
      const full = `${e.firstName} ${e.lastName} ${e.nickname ?? ""}`.toLowerCase();
      return full.includes(q);
    }).slice(0, 8);
  }, [rawEmployees, empQuery]);

  const isFreeText = empQuery.trim().length > 0 && !selectedEmp;

  async function handleSave() {
    if (!storeId || !date || !startTime || !endTime) {
      toast({ title: "Fill in all required fields", variant: "destructive" }); return;
    }
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        storeId,
        date,
        actualStartTime: startTime,
        actualEndTime: endTime,
      };
      if (selectedEmp) {
        payload.employeeId = selectedEmp.id;
      } else if (isFreeText) {
        payload.adjustmentReason = `Added by manager for: ${empQuery.trim()}`;
      } else {
        toast({ title: "Select or enter an employee name", variant: "destructive" });
        setSaving(false); return;
      }
      await apiRequest("POST", "/api/admin/approvals/add-shift", payload);
      toast({ title: "Shift added successfully" });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/approvals"] });
      onOpenChange(false);
    } catch {
      toast({ title: "Failed to add shift", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  const hoursPreview = calcHoursPreview(startTime, endTime);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>Add Shift</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Employee Search */}
          <div className="space-y-1.5">
            <Label>Employee <span className="text-destructive">*</span></Label>
            <div className="relative" ref={dropdownRef}>
              <Input
                placeholder="Search by name or nickname…"
                value={selectedEmp ? (selectedEmp.nickname || `${selectedEmp.firstName} ${selectedEmp.lastName}`) : empQuery}
                onChange={e => {
                  setEmpQuery(e.target.value);
                  setSelectedEmp(null);
                  setShowDrop(true);
                }}
                onFocus={() => { if (empQuery && !selectedEmp) setShowDrop(true); }}
                data-testid="input-standalone-employee"
              />
              {selectedEmp && (
                <button
                  type="button"
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  onClick={() => { setSelectedEmp(null); setEmpQuery(""); setShowDrop(false); }}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
              {showDrop && filteredEmps.length > 0 && !selectedEmp && (
                <div className="absolute z-50 w-full mt-1 bg-popover border border-border rounded-md shadow-md max-h-52 overflow-y-auto">
                  {filteredEmps.map(e => (
                    <button
                      key={e.id}
                      type="button"
                      className="w-full flex items-center justify-between px-3 py-2 text-sm hover-elevate text-left"
                      onMouseDown={ev => ev.preventDefault()}
                      onClick={() => { setSelectedEmp(e); setEmpQuery(""); setShowDrop(false); }}
                      data-testid={`option-emp-${e.id}`}
                    >
                      <span>{e.nickname || `${e.firstName} ${e.lastName}`}</span>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${e.status === "ACTIVE" ? "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400" : "bg-muted text-muted-foreground"}`}>
                        {e.status === "ACTIVE" ? "Active" : "Inactive"}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            {isFreeText && (
              <p className="text-[11px] text-muted-foreground">
                No match found — will be saved as unscheduled shift with this name in memo.
              </p>
            )}
          </div>

          {/* Store */}
          <div className="space-y-1.5">
            <Label>Store <span className="text-destructive">*</span></Label>
            <Select value={storeId} onValueChange={setStoreId}>
              <SelectTrigger data-testid="select-standalone-store">
                <SelectValue placeholder="Select store…" />
              </SelectTrigger>
              <SelectContent>
                {rawStores.map(s => (
                  <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Date */}
          <div className="space-y-1.5">
            <Label>Date <span className="text-destructive">*</span></Label>
            <Input type="date" value={date} onChange={e => setDate(e.target.value)} data-testid="input-standalone-date" />
          </div>

          {/* Start / End Time + Hours Preview */}
          <div className="grid grid-cols-3 gap-2">
            <div className="space-y-1.5">
              <Label>Start <span className="text-destructive">*</span></Label>
              <Input type="time" value={startTime} onChange={e => setStartTime(e.target.value)} data-testid="input-standalone-start" />
            </div>
            <div className="space-y-1.5">
              <Label>End <span className="text-destructive">*</span></Label>
              <Input type="time" value={endTime} onChange={e => setEndTime(e.target.value)} data-testid="input-standalone-end" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-muted-foreground">Hours</Label>
              <div className="h-9 flex items-center px-3 rounded-md border border-border bg-muted/40 text-sm font-medium text-foreground" data-testid="text-standalone-hours">
                {hoursPreview}
              </div>
            </div>
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)} data-testid="button-standalone-cancel">Cancel</Button>
          <Button onClick={handleSave} disabled={saving} className="gap-1.5" data-testid="button-standalone-save">
            {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Add Shift
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
  const { currentRole } = useAdminRole();

  // Cycle state — default to AEDT current payroll cycle
  const today = getAEDTToday();
  const currentCycleStart = getPayrollCycleStart(today);
  const [cycleStart, setCycleStart] = useState(currentCycleStart);
  const cycleEnd = getPayrollCycleEnd(cycleStart);
  const isCurrentCycle = cycleStart === currentCycleStart;

  const [statusFilter, setStatusFilter] = useState("PENDING");
  const [storeFilter, setStoreFilter] = useState("ALL");
  const [reviewingGroup, setReviewingGroup] = useState<EmployeeGroup | null>(null);
  const [addShiftOpen, setAddShiftOpen] = useState(false);

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
              onClick={() => setAddShiftOpen(true)}
              data-testid="button-standalone-add-shift"
            >
              <Plus className="h-4 w-4 text-primary" />
              <span className="hidden sm:inline">Add Shift</span>
              <span className="sm:hidden">Add</span>
            </Button>
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
            {currentRole !== "MANAGER" && (
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
            )}
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
                          <th className="py-3 pl-2 pr-4 w-8"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {employeeGroups.map(g => {
                          const displayName = g.employeeNickname || g.employeeName.split(" ")[0];
                          return (
                            <tr
                              key={g.employeeId}
                              className="border-b border-border/20 hover-elevate cursor-pointer transition-colors"
                              onClick={() => setReviewingGroup(g)}
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
                              <td className="py-3 pl-2 pr-4 text-center">
                                <ChevronRight className="h-4 w-4 text-muted-foreground" />
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

      {/* ── Standalone Add Shift Dialog ───────────────────────────────────────── */}
      <StandaloneAddShiftDialog
        open={addShiftOpen}
        onOpenChange={setAddShiftOpen}
        today={today}
      />
    </AdminLayout>
  );
}
