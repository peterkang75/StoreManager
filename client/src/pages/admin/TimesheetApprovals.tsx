import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { AdminLayout } from "@/components/layouts/AdminLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
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
  PenLine,
  Clock,
  X,
  Loader2,
  Calendar,
  ClipboardCheck,
  ArrowRight,
  TrendingUp,
  TrendingDown,
  ChevronLeft,
  ChevronRight,
  DollarSign,
} from "lucide-react";
import { apiRequest } from "@/lib/queryClient";

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

// ── Week Helpers (AEDT = Australia/Sydney) ────────────────────────────────────

/** Returns YYYY-MM-DD for today in Sydney time */
function getAEDTToday(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Australia/Sydney" });
}

/** Format a Date using LOCAL calendar fields (avoids UTC-shift from toISOString) */
function toYMD(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Returns the Monday (YYYY-MM-DD) for the week containing the given date string */
function getMondayOf(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  const day = d.getDay(); // 0=Sun
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return toYMD(d);
}

/** Add N days to a YYYY-MM-DD string, returns YYYY-MM-DD */
function addDays(dateStr: string, n: number): string {
  const d = new Date(dateStr + "T00:00:00");
  d.setDate(d.getDate() + n);
  return toYMD(d);
}

/** Format YYYY-MM-DD as "Mar 09, 2026" */
function fmtWeekDate(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-AU", { day: "2-digit", month: "short", year: "numeric" });
}

// ── Other Helpers ─────────────────────────────────────────────────────────────

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

type DiscrepancyType = "tardy_or_early" | "overtime" | "ok" | "unscheduled";

function getDiscrepancy(ts: EnrichedTimesheet): DiscrepancyType {
  if (ts.isUnscheduled) return "unscheduled";
  if (!ts.scheduledStartTime || !ts.scheduledEndTime) return "ok";
  const schedStart = toMinutes(ts.scheduledStartTime);
  const schedEnd = toMinutes(ts.scheduledEndTime);
  const actStart = toMinutes(ts.actualStartTime);
  const actEnd = toMinutes(ts.actualEndTime);
  if (actStart > schedStart + 5 || actEnd < schedEnd - 5) return "tardy_or_early";
  if (actEnd > schedEnd + 5) return "overtime";
  return "ok";
}

const STORE_COLORS: Record<string, string> = {
  Sushi: "#16a34a",
  Sandwich: "#dc2626",
};
function storeColor(n: string): string {
  return STORE_COLORS[n] ?? "#6366f1";
}

// ── Discrepancy Badge ──────────────────────────────────────────────────────────

function DiscrepancyBadge({ type }: { type: DiscrepancyType }) {
  if (type === "tardy_or_early")
    return (
      <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-destructive/10 text-destructive border border-destructive/30" data-testid="badge-tardy">
        <TrendingDown className="h-3 w-3" /> Late / Short
      </span>
    );
  if (type === "overtime")
    return (
      <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-orange-500/10 text-orange-600 dark:text-orange-400 border border-orange-500/30" data-testid="badge-overtime">
        <TrendingUp className="h-3 w-3" /> Overtime
      </span>
    );
  if (type === "unscheduled")
    return (
      <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-purple-500/10 text-purple-700 dark:text-purple-300 border border-purple-500/30" data-testid="badge-unscheduled">
        <Calendar className="h-3 w-3" /> Unscheduled
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-green-500/10 text-green-700 dark:text-green-400 border border-green-500/30" data-testid="badge-ok">
      <CheckCircle2 className="h-3 w-3" /> On Time
    </span>
  );
}

// ── Time Cell (desktop) ────────────────────────────────────────────────────────

function TimeCell({ actual, scheduled, isStart }: { actual: string; scheduled: string | null; isStart: boolean }) {
  const disc = (() => {
    if (!scheduled) return "ok";
    const diff = toMinutes(actual) - toMinutes(scheduled);
    if (isStart) return diff > 5 ? "bad" : "ok";
    return diff < -5 ? "bad" : diff > 5 ? "overtime" : "ok";
  })();
  const cls =
    disc === "bad" ? "text-destructive font-semibold"
    : disc === "overtime" ? "text-orange-600 dark:text-orange-400 font-semibold"
    : "text-foreground";
  return (
    <div className="flex flex-col leading-tight">
      <span className={`text-sm ${cls}`}>{fmtTime(actual)}</span>
      {scheduled && <span className="text-[11px] text-muted-foreground">{fmtTime(scheduled)}</span>}
    </div>
  );
}

// ── Mobile Card ────────────────────────────────────────────────────────────────

function ApprovalCard({
  ts, selected, onSelect, onApprove, onEdit, approving,
}: {
  ts: EnrichedTimesheet;
  selected: boolean;
  onSelect: (id: string, checked: boolean) => void;
  onApprove: (id: string) => void;
  onEdit: (ts: EnrichedTimesheet) => void;
  approving: boolean;
}) {
  const disc = getDiscrepancy(ts);
  const actualHours = calcHours(ts.actualStartTime, ts.actualEndTime);
  const scheduledHours =
    ts.scheduledStartTime && ts.scheduledEndTime
      ? calcHours(ts.scheduledStartTime, ts.scheduledEndTime)
      : null;

  const delta =
    scheduledHours !== null
      ? actualHours > scheduledHours
        ? `+${fmtHours(actualHours - scheduledHours)}`
        : actualHours < scheduledHours
        ? `-${fmtHours(scheduledHours - actualHours)}`
        : null
      : null;

  const accentColor =
    disc === "tardy_or_early" ? "border-l-destructive"
    : disc === "overtime" ? "border-l-orange-500"
    : disc === "unscheduled" ? "border-l-purple-500"
    : "border-l-green-500";

  const hoursColor =
    disc === "tardy_or_early" ? "text-destructive"
    : disc === "overtime" ? "text-orange-600 dark:text-orange-400"
    : "text-foreground";

  const isApproved = ts.status === "APPROVED";

  return (
    <div
      className={`bg-card rounded-xl border border-border/40 border-l-4 ${accentColor} shadow-sm overflow-hidden`}
      data-testid={`row-timesheet-${ts.id}`}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 pt-4 pb-2 gap-2">
        <div className="flex items-center gap-2.5 min-w-0">
          {!isApproved && (
            <Checkbox
              checked={selected}
              onCheckedChange={v => onSelect(ts.id, !!v)}
              data-testid={`checkbox-select-${ts.id}`}
            />
          )}
          <div className="min-w-0">
            <p className="font-bold text-base leading-tight truncate">
              {ts.employeeNickname || ts.employeeName.split(" ")[0]}
            </p>
            <p className="text-[11px] text-muted-foreground">{fmtDate(ts.date)}</p>
          </div>
        </div>
        <div className="shrink-0 flex items-center gap-2">
          {isApproved && (
            <span className="text-[10px] font-semibold text-green-600 dark:text-green-400 bg-green-500/10 border border-green-500/30 px-2 py-0.5 rounded-full">
              Approved
            </span>
          )}
          <DiscrepancyBadge type={disc} />
        </div>
      </div>

      {/* Body */}
      <div className="px-4 pb-3 space-y-2.5">
        {/* Store */}
        <div className="flex items-center gap-2">
          <div className="h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: storeColor(ts.storeName) }} />
          <span className="text-sm text-muted-foreground font-medium">{ts.storeName}</span>
        </div>

        {/* Hours big display */}
        <div className="flex items-end justify-between gap-4">
          <div>
            <p className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wide mb-0.5">Actual Hours</p>
            <div className="flex items-baseline gap-2">
              <span className={`text-3xl font-black leading-none ${hoursColor}`}>{fmtHours(actualHours)}</span>
              {delta && (
                <span className={`text-sm font-bold ${delta.startsWith("+") ? "text-orange-500" : "text-destructive"}`}>
                  {delta}
                </span>
              )}
            </div>
          </div>
          <div className="text-right shrink-0">
            <p className="text-[11px] text-muted-foreground font-mono">
              {fmtTime(ts.actualStartTime)} – {fmtTime(ts.actualEndTime)}
            </p>
            {ts.scheduledStartTime && (
              <p className="text-[10px] text-muted-foreground/60">
                Sched: {fmtTime(ts.scheduledStartTime)} – {fmtTime(ts.scheduledEndTime)}
              </p>
            )}
          </div>
        </div>

        {ts.isUnscheduled && (
          <p className="text-[11px] text-purple-600 dark:text-purple-400 font-medium italic">
            No roster shift — unscheduled entry
          </p>
        )}
        {ts.adjustmentReason && (
          <p className="text-xs text-muted-foreground bg-muted/40 rounded-md px-2 py-1.5 leading-snug">
            {ts.adjustmentReason}
          </p>
        )}
      </div>

      {/* Actions */}
      {!isApproved && (
        <div className="flex gap-2 px-4 pb-4">
          <Button
            className="flex-1 min-h-[44px] bg-green-600 text-white font-semibold"
            onClick={() => onApprove(ts.id)}
            disabled={approving}
            data-testid={`button-approve-${ts.id}`}
          >
            {approving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <CheckCircle2 className="h-4 w-4 mr-2" />}
            Approve
          </Button>
          <Button
            variant="outline"
            className="flex-1 min-h-[44px] font-semibold"
            onClick={() => onEdit(ts)}
            data-testid={`button-edit-${ts.id}`}
          >
            <PenLine className="h-4 w-4 mr-2" />
            Edit
          </Button>
        </div>
      )}
    </div>
  );
}

// ── Desktop Row ────────────────────────────────────────────────────────────────

function ApprovalRow({
  ts, selected, onSelect, onApprove, onEdit,
}: {
  ts: EnrichedTimesheet;
  selected: boolean;
  onSelect: (id: string, checked: boolean) => void;
  onApprove: (id: string) => void;
  onEdit: (ts: EnrichedTimesheet) => void;
}) {
  const disc = getDiscrepancy(ts);
  const rowBg =
    disc === "tardy_or_early" ? "bg-destructive/5"
    : disc === "overtime" ? "bg-orange-500/5"
    : "";
  const actualHours = calcHours(ts.actualStartTime, ts.actualEndTime);
  const scheduledHours =
    ts.scheduledStartTime && ts.scheduledEndTime
      ? calcHours(ts.scheduledStartTime, ts.scheduledEndTime)
      : null;
  const isApproved = ts.status === "APPROVED";

  return (
    <tr
      className={`border-b border-border/30 transition-colors hover:bg-muted/20 ${rowBg} ${isApproved ? "opacity-60" : ""}`}
      data-testid={`row-timesheet-${ts.id}`}
    >
      <td className="w-10 pl-4 pr-2 py-3">
        {!isApproved && (
          <Checkbox checked={selected} onCheckedChange={v => onSelect(ts.id, !!v)} data-testid={`checkbox-select-${ts.id}`} />
        )}
      </td>
      <td className="py-3 px-3 whitespace-nowrap">
        <div className="text-sm font-medium">{fmtDate(ts.date)}</div>
      </td>
      <td className="py-3 px-3 whitespace-nowrap">
        <div className="flex items-center gap-2">
          <div className="h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: storeColor(ts.storeName) }} />
          <span className="text-sm font-medium">{ts.storeName}</span>
        </div>
      </td>
      <td className="py-3 px-3">
        <div className="flex flex-col">
          <span className="text-sm font-semibold">{ts.employeeNickname || ts.employeeName.split(" ")[0]}</span>
          <span className="text-[11px] text-muted-foreground truncate max-w-[120px]">{ts.employeeName}</span>
        </div>
      </td>
      <td className="py-3 px-3 whitespace-nowrap">
        {ts.scheduledStartTime ? (
          <div className="flex items-center gap-1 text-sm text-muted-foreground font-mono">
            <span>{fmtTime(ts.scheduledStartTime)}</span>
            <ArrowRight className="h-3 w-3 shrink-0" />
            <span>{fmtTime(ts.scheduledEndTime)}</span>
          </div>
        ) : (
          <span className="text-xs text-muted-foreground italic">{ts.isUnscheduled ? "No roster" : "—"}</span>
        )}
        {scheduledHours !== null && <div className="text-[11px] text-muted-foreground">{fmtHours(scheduledHours)}</div>}
      </td>
      <td className="py-3 px-3 whitespace-nowrap">
        <TimeCell actual={ts.actualStartTime} scheduled={ts.scheduledStartTime} isStart={true} />
      </td>
      <td className="py-3 px-3 whitespace-nowrap">
        <TimeCell actual={ts.actualEndTime} scheduled={ts.scheduledEndTime} isStart={false} />
      </td>
      <td className="py-3 px-3 whitespace-nowrap">
        <div className="flex flex-col">
          <span className={`text-sm font-bold ${disc === "overtime" ? "text-orange-600 dark:text-orange-400" : disc === "tardy_or_early" ? "text-destructive" : "text-foreground"}`}>
            {fmtHours(actualHours)}
          </span>
          {scheduledHours !== null && (
            <span className="text-[11px] text-muted-foreground">
              {actualHours > scheduledHours ? `+${fmtHours(actualHours - scheduledHours)}`
                : actualHours < scheduledHours ? `-${fmtHours(scheduledHours - actualHours)}`
                : "exact"}
            </span>
          )}
        </div>
      </td>
      <td className="py-3 px-3 whitespace-nowrap">
        {isApproved
          ? <span className="text-xs font-semibold text-green-600 dark:text-green-400">Approved</span>
          : <DiscrepancyBadge type={disc} />
        }
      </td>
      <td className="py-3 pl-2 pr-4 whitespace-nowrap">
        {!isApproved && (
          <div className="flex items-center gap-1.5">
            <Button
              size="sm"
              variant="outline"
              className="h-9 px-3 border-green-500/50 text-green-700 dark:text-green-400"
              onClick={() => onApprove(ts.id)}
              data-testid={`button-approve-${ts.id}`}
            >
              <CheckCircle2 className="h-3.5 w-3.5 mr-1" /> Approve
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-9 px-3"
              onClick={() => onEdit(ts)}
              data-testid={`button-edit-${ts.id}`}
            >
              <PenLine className="h-3.5 w-3.5 mr-1" /> Edit
            </Button>
          </div>
        )}
      </td>
    </tr>
  );
}

// ── Edit & Approve Bottom Sheet / Modal ────────────────────────────────────────

function EditApproveModal({
  ts, onClose, onSaved,
}: {
  ts: EnrichedTimesheet;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [startTime, setStartTime] = useState(ts.actualStartTime);
  const [endTime, setEndTime] = useState(ts.actualEndTime);
  const [reason, setReason] = useState(ts.adjustmentReason ?? "");

  const editMutation = useMutation({
    mutationFn: () =>
      apiRequest("PUT", `/api/admin/approvals/${ts.id}/edit-approve`, {
        actualStartTime: startTime,
        actualEndTime: endTime,
        adjustmentReason: reason,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/approvals"] });
      toast({ title: "Timesheet Approved", description: `${ts.employeeNickname || ts.employeeName} — adjusted and approved.` });
      onSaved();
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to save changes.", variant: "destructive" });
    },
  });

  const hoursActual = calcHours(startTime, endTime);

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex flex-col justify-end md:justify-center md:items-center md:p-4"
      onClick={onClose}
    >
      <div
        className="w-full md:max-w-lg bg-card md:rounded-xl rounded-t-2xl border border-border/40 shadow-2xl flex flex-col max-h-[92dvh] md:max-h-none"
        onClick={e => e.stopPropagation()}
        data-testid="edit-approve-modal"
      >
        {/* Drag handle */}
        <div className="md:hidden flex justify-center pt-3 pb-1 shrink-0">
          <div className="w-10 h-1 rounded-full bg-muted-foreground/30" />
        </div>

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border/40 shrink-0">
          <div>
            <h2 className="font-bold text-base">Edit &amp; Approve Timesheet</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              {ts.employeeNickname || ts.employeeName} · {fmtDate(ts.date)} · {ts.storeName}
            </p>
          </div>
          <Button size="icon" variant="ghost" onClick={onClose} data-testid="button-modal-close">
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Scrollable body */}
        <div className="overflow-y-auto flex-1 p-5 space-y-5">
          {ts.scheduledStartTime && (
            <div className="rounded-md bg-muted/40 border border-border/30 px-4 py-3 flex items-center gap-3">
              <Clock className="h-4 w-4 text-muted-foreground shrink-0" />
              <div className="text-sm">
                <span className="text-muted-foreground">Scheduled: </span>
                <span className="font-medium">{fmtTime(ts.scheduledStartTime)} – {fmtTime(ts.scheduledEndTime)}</span>
                <span className="text-muted-foreground ml-2">({fmtHours(calcHours(ts.scheduledStartTime, ts.scheduledEndTime!))})</span>
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground font-medium">Adjusted Start</Label>
              <Input type="time" value={startTime} onChange={e => setStartTime(e.target.value)} className="font-mono min-h-[44px]" data-testid="input-adjusted-start" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground font-medium">Adjusted End</Label>
              <Input type="time" value={endTime} onChange={e => setEndTime(e.target.value)} className="font-mono min-h-[44px]" data-testid="input-adjusted-end" />
            </div>
          </div>

          <div className="rounded-md bg-muted/40 border border-border/20 px-4 py-3 flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Adjusted total</span>
            <div className="flex items-center gap-3">
              <span className="text-xl font-black text-primary">{fmtHours(hoursActual)}</span>
              {ts.scheduledStartTime && ts.scheduledEndTime && (
                <span className="text-sm text-muted-foreground">vs {fmtHours(calcHours(ts.scheduledStartTime, ts.scheduledEndTime))} sched</span>
              )}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground font-medium">
              Reason for Adjustment <span className="text-destructive">*</span>
            </Label>
            <Textarea
              value={reason}
              onChange={e => setReason(e.target.value)}
              placeholder="e.g. Forgot to clock out, manager confirmed actual hours"
              className="resize-none"
              rows={4}
              data-testid="textarea-adjustment-reason"
            />
            {reason.trim() === "" && (
              <p className="text-xs text-destructive" data-testid="error-reason-required">Reason is required to save</p>
            )}
          </div>
        </div>

        {/* Pinned footer */}
        <div className="flex gap-2 px-5 py-4 border-t border-border/40 shrink-0 pb-[calc(1rem+env(safe-area-inset-bottom))]">
          <Button variant="outline" className="flex-1 min-h-[44px]" onClick={onClose} data-testid="button-modal-cancel">Cancel</Button>
          <Button
            className="flex-[2] min-h-[44px] bg-green-600 text-white font-semibold"
            onClick={() => editMutation.mutate()}
            disabled={editMutation.isPending || !reason.trim()}
            data-testid="button-modal-save-approve"
          >
            {editMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <CheckCircle2 className="h-4 w-4 mr-2" />}
            Save &amp; Approve
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── Week Navigator ─────────────────────────────────────────────────────────────

function WeekNavigator({
  weekStart,
  onPrev,
  onNext,
  isThisWeek,
  onToday,
}: {
  weekStart: string;
  onPrev: () => void;
  onNext: () => void;
  isThisWeek: boolean;
  onToday: () => void;
}) {
  const weekEnd = addDays(weekStart, 6);
  return (
    <div className="flex items-center gap-1.5" data-testid="week-navigator">
      <Button
        size="icon"
        variant="outline"
        className="h-9 w-9 shrink-0"
        onClick={onPrev}
        data-testid="button-week-prev"
      >
        <ChevronLeft className="h-4 w-4" />
      </Button>

      <div className="flex-1 text-center min-w-0">
        <p className="text-sm font-semibold leading-tight whitespace-nowrap">
          {fmtWeekDate(weekStart)} – {fmtWeekDate(weekEnd)}
        </p>
        <p className="text-[10px] text-muted-foreground">Mon – Sun (AEDT)</p>
      </div>

      <Button
        size="icon"
        variant="outline"
        className="h-9 w-9 shrink-0"
        onClick={onNext}
        data-testid="button-week-next"
      >
        <ChevronRight className="h-4 w-4" />
      </Button>

      {!isThisWeek && (
        <Button
          variant="outline"
          size="sm"
          className="shrink-0 h-9 text-xs"
          onClick={onToday}
          data-testid="button-week-today"
        >
          This Week
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

  // Week state — default to AEDT this week's Monday
  const thisWeekMonday = getMondayOf(getAEDTToday());
  const [weekStart, setWeekStart] = useState(thisWeekMonday);
  const weekEnd = addDays(weekStart, 6);
  const isThisWeek = weekStart === thisWeekMonday;

  const [statusFilter, setStatusFilter] = useState("PENDING");
  const [storeFilter, setStoreFilter] = useState("ALL");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editingTs, setEditingTs] = useState<EnrichedTimesheet | null>(null);
  const [approvingId, setApprovingId] = useState<string | null>(null);

  const { data: timesheets, isLoading } = useQuery<EnrichedTimesheet[]>({
    queryKey: ["/api/admin/approvals", statusFilter],
    queryFn: () => fetch(`/api/admin/approvals?status=${statusFilter}`).then(r => r.json()),
    staleTime: 0,
  });

  // Filter by week + store
  const filtered = useMemo(() => {
    if (!timesheets) return [];
    return timesheets.filter(t => {
      const inWeek = t.date >= weekStart && t.date <= weekEnd;
      const inStore = storeFilter === "ALL" || t.storeId === storeFilter;
      return inWeek && inStore;
    });
  }, [timesheets, weekStart, weekEnd, storeFilter]);

  const stores = useMemo(() => {
    if (!timesheets) return [];
    const seen = new Map<string, { id: string; name: string }>();
    timesheets.forEach(t => { if (!seen.has(t.storeId)) seen.set(t.storeId, { id: t.storeId, name: t.storeName }); });
    return Array.from(seen.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [timesheets]);

  const approveMutation = useMutation({
    mutationFn: (id: string) => {
      setApprovingId(id);
      return apiRequest("PUT", `/api/admin/approvals/${id}/approve`);
    },
    onSuccess: (_, id) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/approvals"] });
      setSelected(s => { const n = new Set(s); n.delete(id); return n; });
      setApprovingId(null);
      toast({ title: "Approved", description: "Timesheet approved successfully." });
    },
    onError: () => {
      setApprovingId(null);
      toast({ title: "Error", description: "Failed to approve.", variant: "destructive" });
    },
  });

  const bulkApproveMutation = useMutation({
    mutationFn: (ids: string[]) => apiRequest("POST", "/api/admin/approvals/bulk-approve", { ids }),
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/approvals"] });
      setSelected(new Set());
      toast({ title: `${data?.approved ?? selected.size} Timesheets Approved`, description: "Bulk approval complete." });
    },
    onError: () => toast({ title: "Error", description: "Bulk approval failed.", variant: "destructive" }),
  });

  const pendingFiltered = filtered.filter(t => t.status === "PENDING");
  const allIds = pendingFiltered.map(t => t.id);
  const allSelected = allIds.length > 0 && allIds.every(id => selected.has(id));
  const someSelected = selected.size > 0;

  const handleSelectAll = (checked: boolean) => {
    if (checked) setSelected(new Set(allIds));
    else setSelected(new Set());
  };

  const handleSelectOne = (id: string, checked: boolean) => {
    setSelected(s => {
      const n = new Set(s);
      if (checked) n.add(id);
      else n.delete(id);
      return n;
    });
  };

  const counts = useMemo(() => {
    return filtered.reduce(
      (acc, ts) => {
        const d = getDiscrepancy(ts);
        if (d === "tardy_or_early") acc.tardy++;
        else if (d === "overtime") acc.overtime++;
        else if (d === "unscheduled") acc.unscheduled++;
        else acc.ok++;
        return acc;
      },
      { tardy: 0, overtime: 0, unscheduled: 0, ok: 0 }
    );
  }, [filtered]);

  return (
    <AdminLayout title="Pending Approvals">
      <div className={`space-y-4 ${someSelected ? "pb-24 md:pb-0" : ""}`}>

        {/* ── Top Header ───────────────────────────────────────────────────── */}
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-xl md:text-2xl font-bold tracking-tight flex items-center gap-2">
              <ClipboardCheck className="h-5 w-5 text-primary" />
              Pending Approvals
            </h2>
            <p className="text-muted-foreground text-xs mt-0.5">타임시트 검토 및 승인</p>
          </div>
          <Button
            variant="outline"
            className="h-9 gap-2 text-sm shrink-0"
            onClick={() => navigate(`/admin/weekly-payroll?weekStart=${weekStart}`)}
            data-testid="button-goto-payroll"
          >
            <DollarSign className="h-4 w-4 text-primary" />
            <span className="hidden sm:inline">Weekly Payroll</span>
            <span className="sm:hidden">Payroll</span>
          </Button>
        </div>

        {/* ── Week Navigator ────────────────────────────────────────────────── */}
        <div className="rounded-lg border border-border/40 bg-card px-3 py-2.5">
          <WeekNavigator
            weekStart={weekStart}
            onPrev={() => { setWeekStart(w => addDays(w, -7)); setSelected(new Set()); }}
            onNext={() => { setWeekStart(w => addDays(w, 7)); setSelected(new Set()); }}
            isThisWeek={isThisWeek}
            onToday={() => { setWeekStart(thisWeekMonday); setSelected(new Set()); }}
          />
        </div>

        {/* ── Summary Row — scrollable on mobile ────────────────────────────── */}
        {!isLoading && filtered.length > 0 && (
          <div className="flex gap-3 overflow-x-auto pb-1 -mx-1 px-1 md:grid md:grid-cols-4 md:overflow-visible">
            {[
              { label: "Total", value: filtered.length, icon: <ClipboardCheck className="h-4 w-4 text-muted-foreground" />, border: "border-border/40 bg-card", text: "text-foreground" },
              { label: "Discrepancies", value: counts.tardy, icon: <TrendingDown className="h-4 w-4 text-destructive" />, border: "border-destructive/40 bg-destructive/5", text: "text-destructive" },
              { label: "Overtime", value: counts.overtime, icon: <TrendingUp className="h-4 w-4 text-orange-500" />, border: "border-orange-400/40 bg-orange-500/5", text: "text-orange-600 dark:text-orange-400" },
              { label: "On Time", value: counts.ok, icon: <CheckCircle2 className="h-4 w-4 text-green-600" />, border: "border-green-500/40 bg-green-500/5", text: "text-green-600 dark:text-green-400" },
            ].map(item => (
              <div
                key={item.label}
                className={`shrink-0 w-32 md:w-auto rounded-lg border ${item.border} px-3 py-2.5 flex items-center gap-2`}
                data-testid={`summary-${item.label.toLowerCase().replace(/\s+/g, "-")}`}
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

        {/* ── Sticky Filter + Select All Bar ────────────────────────────────── */}
        <div className="sticky top-0 z-30 bg-background/95 backdrop-blur-sm border-b border-border/30 -mx-4 md:-mx-6 px-4 md:px-6 py-2.5 flex items-center gap-2">
          {statusFilter === "PENDING" && filtered.length > 0 && (
            <div className="flex items-center gap-1.5 mr-1">
              <Checkbox
                checked={allSelected}
                onCheckedChange={handleSelectAll}
                data-testid="checkbox-select-all"
              />
              <span className="text-xs text-muted-foreground hidden sm:inline">All</span>
            </div>
          )}

          <Select value={storeFilter} onValueChange={setStoreFilter}>
            <SelectTrigger className="flex-1 min-w-0 h-9" data-testid="select-store-filter">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All Stores</SelectItem>
              {stores.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
            </SelectContent>
          </Select>

          <Select value={statusFilter} onValueChange={v => { setStatusFilter(v); setSelected(new Set()); }}>
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
              {filtered.length} item{filtered.length !== 1 ? "s" : ""}
            </span>
          )}
        </div>

        {/* ── Content ──────────────────────────────────────────────────────── */}
        {isLoading ? (
          <div className="space-y-3">
            {[1, 2, 3].map(i => <Skeleton key={i} className="h-44 w-full rounded-xl" />)}
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center" data-testid="empty-state">
            <ClipboardCheck className="h-12 w-12 text-muted-foreground/30 mb-4" />
            <p className="font-semibold text-muted-foreground">
              {statusFilter === "PENDING" ? "All caught up for this week!" : "No timesheets found"}
            </p>
            <p className="text-sm text-muted-foreground mt-1">
              {statusFilter === "PENDING"
                ? "No pending timesheets for this week require approval."
                : "Try changing the week or adjusting filters."}
            </p>
            {!isThisWeek && (
              <Button variant="outline" size="sm" className="mt-4" onClick={() => setWeekStart(thisWeekMonday)} data-testid="button-back-to-this-week">
                Back to This Week
              </Button>
            )}
          </div>
        ) : (
          <>
            {/* ── Mobile Card List ── */}
            <div className="md:hidden space-y-3" data-testid="approvals-card-list">
              {filtered.map(ts => (
                <ApprovalCard
                  key={ts.id}
                  ts={ts}
                  selected={selected.has(ts.id)}
                  onSelect={handleSelectOne}
                  onApprove={id => approveMutation.mutate(id)}
                  onEdit={setEditingTs}
                  approving={approvingId === ts.id && approveMutation.isPending}
                />
              ))}
            </div>

            {/* ── Desktop Table ── */}
            <div className="hidden md:block">
              <Card>
                <CardContent className="p-0">
                  <div className="overflow-x-auto">
                    <table className="w-full text-left" data-testid="approvals-table">
                      <thead>
                        <tr className="border-b border-border/40 bg-muted/30">
                          <th className="w-10 pl-4 pr-2 py-3">
                            {statusFilter === "PENDING" && (
                              <Checkbox checked={allSelected} onCheckedChange={handleSelectAll} data-testid="checkbox-select-all" />
                            )}
                          </th>
                          <th className="py-3 px-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap">Date</th>
                          <th className="py-3 px-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Store</th>
                          <th className="py-3 px-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Employee</th>
                          <th className="py-3 px-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap">Scheduled</th>
                          <th className="py-3 px-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap">
                            Start <span className="block text-[10px] font-normal normal-case tracking-normal">Actual / Sched</span>
                          </th>
                          <th className="py-3 px-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap">
                            End <span className="block text-[10px] font-normal normal-case tracking-normal">Actual / Sched</span>
                          </th>
                          <th className="py-3 px-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap">Hours</th>
                          <th className="py-3 px-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Status</th>
                          <th className="py-3 pl-2 pr-4 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filtered.map(ts => (
                          <ApprovalRow
                            key={ts.id}
                            ts={ts}
                            selected={selected.has(ts.id)}
                            onSelect={handleSelectOne}
                            onApprove={id => approveMutation.mutate(id)}
                            onEdit={setEditingTs}
                          />
                        ))}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>

              {/* Desktop bulk bar */}
              {someSelected && statusFilter === "PENDING" && (
                <div className="flex items-center gap-3 rounded-lg border border-primary/30 bg-primary/5 px-4 py-3 mt-3" data-testid="bulk-action-bar">
                  <span className="text-sm font-medium">{selected.size} selected</span>
                  <Button
                    size="sm"
                    className="ml-auto bg-green-600 text-white"
                    onClick={() => bulkApproveMutation.mutate(Array.from(selected))}
                    disabled={bulkApproveMutation.isPending}
                    data-testid="button-bulk-approve"
                  >
                    {bulkApproveMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <CheckCircle2 className="h-4 w-4 mr-2" />}
                    Approve Selected ({selected.size})
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setSelected(new Set())} data-testid="button-clear-selection">Clear</Button>
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* ── Mobile Floating Bulk Bar ──────────────────────────────────────────── */}
      {someSelected && statusFilter === "PENDING" && (
        <div
          className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-card/95 backdrop-blur-md border-t border-border/40 shadow-2xl px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]"
          data-testid="bulk-action-bar"
        >
          <div className="flex items-center gap-2">
            <div className="text-sm font-semibold mr-auto">
              <span className="text-primary">{selected.size}</span>
              <span className="text-muted-foreground"> selected</span>
            </div>
            <Button variant="outline" className="min-h-[44px]" onClick={() => setSelected(new Set())} data-testid="button-clear-selection">
              Clear
            </Button>
            <Button
              className="flex-1 min-h-[44px] bg-green-600 text-white font-bold"
              onClick={() => bulkApproveMutation.mutate(Array.from(selected))}
              disabled={bulkApproveMutation.isPending}
              data-testid="button-bulk-approve"
            >
              {bulkApproveMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <CheckCircle2 className="h-4 w-4 mr-2" />}
              Approve {selected.size}
            </Button>
          </div>
        </div>
      )}

      {/* ── Edit & Approve Modal ─────────────────────────────────────────────── */}
      {editingTs && (
        <EditApproveModal
          ts={editingTs}
          onClose={() => setEditingTs(null)}
          onSaved={() => setEditingTs(null)}
        />
      )}
    </AdminLayout>
  );
}
