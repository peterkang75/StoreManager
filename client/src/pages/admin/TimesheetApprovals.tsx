import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AdminLayout } from "@/components/layouts/AdminLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
  AlertTriangle,
  Clock,
  CheckSquare,
  ChevronRight,
  X,
  Loader2,
  Calendar,
  User,
  Store,
  ClipboardCheck,
  ArrowRight,
  TrendingUp,
  TrendingDown,
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

// ── Helpers ────────────────────────────────────────────────────────────────────

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

  const lateStart = actStart > schedStart + 5;
  const earlyEnd = actEnd < schedEnd - 5;
  const overtime = actEnd > schedEnd + 5;

  if (lateStart || earlyEnd) return "tardy_or_early";
  if (overtime) return "overtime";
  return "ok";
}

const STORE_COLORS: Record<string, string> = {
  Sushi: "#16a34a",
  Sandwich: "#dc2626",
};

function storeColor(storeName: string): string {
  return STORE_COLORS[storeName] ?? "#6366f1";
}

// ── Edit & Approve Modal ───────────────────────────────────────────────────────

function EditApproveModal({
  ts,
  onClose,
  onSaved,
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
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg bg-card rounded-xl border border-border/40 shadow-2xl"
        onClick={e => e.stopPropagation()}
        data-testid="edit-approve-modal"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border/40">
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

        <div className="p-5 space-y-5">
          {/* Scheduled reference */}
          {ts.scheduledStartTime && (
            <div className="rounded-md bg-muted/40 border border-border/30 px-4 py-3 flex items-center gap-4">
              <Clock className="h-4 w-4 text-muted-foreground shrink-0" />
              <div className="text-sm">
                <span className="text-muted-foreground">Scheduled: </span>
                <span className="font-medium">{fmtTime(ts.scheduledStartTime)} – {fmtTime(ts.scheduledEndTime)}</span>
                <span className="text-muted-foreground ml-2">({fmtHours(calcHours(ts.scheduledStartTime, ts.scheduledEndTime!))})</span>
              </div>
            </div>
          )}

          {/* Time editors */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground font-medium">Adjusted Start Time</Label>
              <Input
                type="time"
                value={startTime}
                onChange={e => setStartTime(e.target.value)}
                className="font-mono"
                data-testid="input-adjusted-start"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground font-medium">Adjusted End Time</Label>
              <Input
                type="time"
                value={endTime}
                onChange={e => setEndTime(e.target.value)}
                className="font-mono"
                data-testid="input-adjusted-end"
              />
            </div>
          </div>

          {/* Hours preview */}
          <div className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">Adjusted total:</span>
            <span className="font-bold text-primary">{fmtHours(hoursActual)}</span>
            {ts.scheduledStartTime && ts.scheduledEndTime && (
              <>
                <span className="text-muted-foreground mx-1">vs scheduled</span>
                <span className="font-medium">{fmtHours(calcHours(ts.scheduledStartTime, ts.scheduledEndTime))}</span>
              </>
            )}
          </div>

          {/* Reason */}
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground font-medium">
              Reason for Adjustment <span className="text-destructive">*</span>
            </Label>
            <Textarea
              value={reason}
              onChange={e => setReason(e.target.value)}
              placeholder="e.g. Forgot to clock out, manager confirmed actual hours"
              className="resize-none"
              rows={3}
              data-testid="textarea-adjustment-reason"
            />
            {reason.trim() === "" && (
              <p className="text-xs text-destructive" data-testid="error-reason-required">Reason is required to save</p>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-border/40">
          <Button variant="outline" onClick={onClose} data-testid="button-modal-cancel">Cancel</Button>
          <Button
            onClick={() => editMutation.mutate()}
            disabled={editMutation.isPending || !reason.trim()}
            className="bg-green-600 hover:bg-green-600 text-white"
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

// ── Discrepancy Badge ──────────────────────────────────────────────────────────

function DiscrepancyBadge({ type }: { type: DiscrepancyType }) {
  if (type === "tardy_or_early")
    return (
      <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-destructive/10 text-destructive border border-destructive/30" data-testid="badge-tardy">
        <TrendingDown className="h-3 w-3" />
        Discrepancy
      </span>
    );
  if (type === "overtime")
    return (
      <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-orange-500/10 text-orange-600 dark:text-orange-400 border border-orange-500/30" data-testid="badge-overtime">
        <TrendingUp className="h-3 w-3" />
        Overtime
      </span>
    );
  if (type === "unscheduled")
    return (
      <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-purple-500/10 text-purple-700 dark:text-purple-300 border border-purple-500/30" data-testid="badge-unscheduled">
        <Calendar className="h-3 w-3" />
        Unscheduled
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-green-500/10 text-green-700 dark:text-green-400 border border-green-500/30" data-testid="badge-ok">
      <CheckCircle2 className="h-3 w-3" />
      On Time
    </span>
  );
}

// ── Time Comparison Display ────────────────────────────────────────────────────

function TimeCell({
  actual,
  scheduled,
  isStart,
}: {
  actual: string;
  scheduled: string | null;
  isStart: boolean;
}) {
  const discType: "ok" | "tardy" | "overtime" | "early" = (() => {
    if (!scheduled) return "ok";
    const diff = toMinutes(actual) - toMinutes(scheduled);
    if (isStart) return diff > 5 ? "tardy" : "ok";
    else return diff < -5 ? "early" : diff > 5 ? "overtime" : "ok";
  })();

  const colorClass =
    discType === "tardy" || discType === "early"
      ? "text-destructive font-semibold"
      : discType === "overtime"
      ? "text-orange-600 dark:text-orange-400 font-semibold"
      : "text-foreground";

  return (
    <div className="flex flex-col leading-tight">
      <span className={`text-sm ${colorClass}`}>{fmtTime(actual)}</span>
      {scheduled && (
        <span className="text-[11px] text-muted-foreground">{fmtTime(scheduled)}</span>
      )}
    </div>
  );
}

// ── Row ────────────────────────────────────────────────────────────────────────

function ApprovalRow({
  ts,
  selected,
  onSelect,
  onApprove,
  onEdit,
}: {
  ts: EnrichedTimesheet;
  selected: boolean;
  onSelect: (id: string, checked: boolean) => void;
  onApprove: (id: string) => void;
  onEdit: (ts: EnrichedTimesheet) => void;
}) {
  const disc = getDiscrepancy(ts);
  const isApproving = false;

  const rowBg =
    disc === "tardy_or_early"
      ? "bg-destructive/5 hover:bg-destructive/8"
      : disc === "overtime"
      ? "bg-orange-500/5 hover:bg-orange-500/8"
      : "hover:bg-muted/30";

  const actualHours = calcHours(ts.actualStartTime, ts.actualEndTime);
  const scheduledHours =
    ts.scheduledStartTime && ts.scheduledEndTime
      ? calcHours(ts.scheduledStartTime, ts.scheduledEndTime)
      : null;

  return (
    <tr
      className={`border-b border-border/30 transition-colors ${rowBg}`}
      data-testid={`row-timesheet-${ts.id}`}
    >
      {/* Checkbox */}
      <td className="w-10 pl-4 pr-2 py-3">
        <Checkbox
          checked={selected}
          onCheckedChange={v => onSelect(ts.id, !!v)}
          data-testid={`checkbox-select-${ts.id}`}
        />
      </td>

      {/* Date */}
      <td className="py-3 px-3 whitespace-nowrap">
        <div className="text-sm font-medium">{fmtDate(ts.date)}</div>
        <div className="text-[11px] text-muted-foreground">{ts.date}</div>
      </td>

      {/* Store */}
      <td className="py-3 px-3 whitespace-nowrap">
        <div className="flex items-center gap-2">
          <div
            className="h-2.5 w-2.5 rounded-full shrink-0"
            style={{ backgroundColor: storeColor(ts.storeName) }}
          />
          <span className="text-sm font-medium">{ts.storeName}</span>
        </div>
      </td>

      {/* Employee */}
      <td className="py-3 px-3">
        <div className="flex flex-col">
          <span className="text-sm font-semibold">
            {ts.employeeNickname || ts.employeeName.split(" ")[0]}
          </span>
          <span className="text-[11px] text-muted-foreground truncate max-w-[120px]">
            {ts.employeeName}
          </span>
        </div>
      </td>

      {/* Scheduled time */}
      <td className="py-3 px-3 whitespace-nowrap">
        {ts.scheduledStartTime ? (
          <div className="flex items-center gap-1 text-sm text-muted-foreground font-mono">
            <span>{fmtTime(ts.scheduledStartTime)}</span>
            <ArrowRight className="h-3 w-3 shrink-0" />
            <span>{fmtTime(ts.scheduledEndTime)}</span>
          </div>
        ) : (
          <span className="text-xs text-muted-foreground italic">
            {ts.isUnscheduled ? "No roster" : "—"}
          </span>
        )}
        {scheduledHours !== null && (
          <div className="text-[11px] text-muted-foreground">{fmtHours(scheduledHours)}</div>
        )}
      </td>

      {/* Actual start */}
      <td className="py-3 px-3 whitespace-nowrap">
        <TimeCell
          actual={ts.actualStartTime}
          scheduled={ts.scheduledStartTime}
          isStart={true}
        />
      </td>

      {/* Actual end */}
      <td className="py-3 px-3 whitespace-nowrap">
        <TimeCell
          actual={ts.actualEndTime}
          scheduled={ts.scheduledEndTime}
          isStart={false}
        />
      </td>

      {/* Actual hours */}
      <td className="py-3 px-3 whitespace-nowrap">
        <div className="flex flex-col">
          <span
            className={`text-sm font-bold ${
              disc === "overtime"
                ? "text-orange-600 dark:text-orange-400"
                : disc === "tardy_or_early"
                ? "text-destructive"
                : "text-foreground"
            }`}
          >
            {fmtHours(actualHours)}
          </span>
          {scheduledHours !== null && (
            <span className="text-[11px] text-muted-foreground">
              {actualHours > scheduledHours
                ? `+${fmtHours(actualHours - scheduledHours)}`
                : actualHours < scheduledHours
                ? `-${fmtHours(scheduledHours - actualHours)}`
                : "exact"}
            </span>
          )}
        </div>
      </td>

      {/* Status badge */}
      <td className="py-3 px-3 whitespace-nowrap">
        <DiscrepancyBadge type={disc} />
      </td>

      {/* Actions */}
      <td className="py-3 pl-2 pr-4 whitespace-nowrap">
        <div className="flex items-center gap-1.5">
          <Button
            size="sm"
            variant="outline"
            className="h-8 px-2.5 border-green-500/50 text-green-700 dark:text-green-400 hover:bg-green-500/10"
            onClick={() => onApprove(ts.id)}
            data-testid={`button-approve-${ts.id}`}
          >
            <CheckCircle2 className="h-3.5 w-3.5 mr-1" />
            Approve
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-8 px-2.5"
            onClick={() => onEdit(ts)}
            data-testid={`button-edit-${ts.id}`}
          >
            <PenLine className="h-3.5 w-3.5 mr-1" />
            Edit
          </Button>
        </div>
      </td>
    </tr>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────────

export function AdminTimesheetApprovals() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState("PENDING");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editingTs, setEditingTs] = useState<EnrichedTimesheet | null>(null);
  const [storeFilter, setStoreFilter] = useState("ALL");

  const { data: timesheets, isLoading } = useQuery<EnrichedTimesheet[]>({
    queryKey: ["/api/admin/approvals", statusFilter],
    queryFn: () =>
      fetch(`/api/admin/approvals?status=${statusFilter}`).then(r => r.json()),
    staleTime: 0,
  });

  const filtered = useMemo(() => {
    if (!timesheets) return [];
    if (storeFilter === "ALL") return timesheets;
    return timesheets.filter(t => t.storeId === storeFilter);
  }, [timesheets, storeFilter]);

  const stores = useMemo(() => {
    if (!timesheets) return [];
    const seen = new Map<string, { id: string; name: string }>();
    timesheets.forEach(t => { if (!seen.has(t.storeId)) seen.set(t.storeId, { id: t.storeId, name: t.storeName }); });
    return Array.from(seen.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [timesheets]);

  const approveMutation = useMutation({
    mutationFn: (id: string) => apiRequest("PUT", `/api/admin/approvals/${id}/approve`),
    onSuccess: (_, id) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/approvals"] });
      setSelected(s => { const n = new Set(s); n.delete(id); return n; });
      toast({ title: "Approved", description: "Timesheet approved successfully." });
    },
    onError: () => toast({ title: "Error", description: "Failed to approve.", variant: "destructive" }),
  });

  const bulkApproveMutation = useMutation({
    mutationFn: (ids: string[]) =>
      apiRequest("POST", "/api/admin/approvals/bulk-approve", { ids }),
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/approvals"] });
      setSelected(new Set());
      toast({ title: `${data?.approved ?? "Multiple"} Timesheets Approved`, description: "Bulk approval complete." });
    },
    onError: () => toast({ title: "Error", description: "Bulk approval failed.", variant: "destructive" }),
  });

  const allIds = filtered.map(t => t.id);
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

  // Summary counts
  const counts = useMemo(() => {
    if (!filtered) return { tardy: 0, overtime: 0, unscheduled: 0, ok: 0 };
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
    <AdminLayout title="Approvals">
      <div className="space-y-5">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-2xl font-bold tracking-tight flex items-center gap-2">
              <ClipboardCheck className="h-6 w-6 text-primary" />
              Timesheet Approvals
            </h2>
            <p className="text-muted-foreground text-sm mt-0.5">
              타임시트 검토 및 승인 — Review and approve employee submitted timesheets
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {/* Store filter */}
            <Select value={storeFilter} onValueChange={setStoreFilter}>
              <SelectTrigger className="w-36" data-testid="select-store-filter">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All Stores</SelectItem>
                {stores.map(s => (
                  <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {/* Status filter */}
            <Select value={statusFilter} onValueChange={v => { setStatusFilter(v); setSelected(new Set()); }}>
              <SelectTrigger className="w-36" data-testid="select-status-filter">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="PENDING">Pending</SelectItem>
                <SelectItem value="APPROVED">Approved</SelectItem>
                <SelectItem value="ALL">All</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Summary bar */}
        {!isLoading && filtered.length > 0 && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="rounded-lg border border-border/40 bg-card px-4 py-3 flex items-center gap-3" data-testid="summary-total">
              <ClipboardCheck className="h-5 w-5 text-muted-foreground" />
              <div>
                <p className="text-xs text-muted-foreground">Total Pending</p>
                <p className="text-xl font-bold">{filtered.length}</p>
              </div>
            </div>
            <div className="rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-3 flex items-center gap-3" data-testid="summary-discrepancy">
              <TrendingDown className="h-5 w-5 text-destructive" />
              <div>
                <p className="text-xs text-destructive/80">Discrepancies</p>
                <p className="text-xl font-bold text-destructive">{counts.tardy}</p>
              </div>
            </div>
            <div className="rounded-lg border border-orange-400/40 bg-orange-500/5 px-4 py-3 flex items-center gap-3" data-testid="summary-overtime">
              <TrendingUp className="h-5 w-5 text-orange-500" />
              <div>
                <p className="text-xs text-orange-600/80">Overtime</p>
                <p className="text-xl font-bold text-orange-600 dark:text-orange-400">{counts.overtime}</p>
              </div>
            </div>
            <div className="rounded-lg border border-green-500/40 bg-green-500/5 px-4 py-3 flex items-center gap-3" data-testid="summary-ok">
              <CheckCircle2 className="h-5 w-5 text-green-600" />
              <div>
                <p className="text-xs text-green-600/80">On Time</p>
                <p className="text-xl font-bold text-green-600 dark:text-green-400">{counts.ok}</p>
              </div>
            </div>
          </div>
        )}

        {/* Bulk action bar */}
        {someSelected && statusFilter === "PENDING" && (
          <div className="flex items-center gap-3 rounded-lg border border-primary/30 bg-primary/5 px-4 py-3" data-testid="bulk-action-bar">
            <CheckSquare className="h-4 w-4 text-primary" />
            <span className="text-sm font-medium">{selected.size} selected</span>
            <Button
              size="sm"
              className="ml-auto bg-green-600 hover:bg-green-600 text-white"
              onClick={() => bulkApproveMutation.mutate(Array.from(selected))}
              disabled={bulkApproveMutation.isPending}
              data-testid="button-bulk-approve"
            >
              {bulkApproveMutation.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <CheckCircle2 className="h-4 w-4 mr-2" />
              )}
              Approve Selected ({selected.size})
            </Button>
            <Button size="sm" variant="outline" onClick={() => setSelected(new Set())} data-testid="button-clear-selection">
              Clear
            </Button>
          </div>
        )}

        {/* Legend */}
        <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
          <span className="font-medium">Legend:</span>
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-destructive/40 inline-block" />
            Red row = late start or early finish
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-orange-500/40 inline-block" />
            Orange row = worked more than scheduled
          </span>
          <span className="flex items-center gap-1.5">
            <span className="font-mono text-[11px] text-muted-foreground">Scheduled / Actual</span>
            = shown as stacked times
          </span>
        </div>

        {/* Table */}
        <Card>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="p-6 space-y-3">
                {[1, 2, 3, 4, 5].map(i => <Skeleton key={i} className="h-14 w-full" />)}
              </div>
            ) : filtered.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-center" data-testid="empty-state">
                <ClipboardCheck className="h-12 w-12 text-muted-foreground/30 mb-4" />
                <p className="font-semibold text-muted-foreground">
                  {statusFilter === "PENDING" ? "All caught up!" : "No timesheets found"}
                </p>
                <p className="text-sm text-muted-foreground mt-1">
                  {statusFilter === "PENDING"
                    ? "No pending timesheets require approval right now."
                    : "Try adjusting your filters."}
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left" data-testid="approvals-table">
                  <thead>
                    <tr className="border-b border-border/40 bg-muted/30">
                      <th className="w-10 pl-4 pr-2 py-3">
                        {statusFilter === "PENDING" && (
                          <Checkbox
                            checked={allSelected}
                            onCheckedChange={handleSelectAll}
                            data-testid="checkbox-select-all"
                          />
                        )}
                      </th>
                      <th className="py-3 px-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap">Date</th>
                      <th className="py-3 px-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Store</th>
                      <th className="py-3 px-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Employee</th>
                      <th className="py-3 px-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap">Scheduled</th>
                      <th className="py-3 px-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap">
                        Start
                        <span className="block text-[10px] font-normal normal-case tracking-normal">Actual / Sched</span>
                      </th>
                      <th className="py-3 px-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap">
                        End
                        <span className="block text-[10px] font-normal normal-case tracking-normal">Actual / Sched</span>
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
            )}
          </CardContent>
        </Card>

        {/* Footer count */}
        {!isLoading && filtered.length > 0 && (
          <p className="text-xs text-muted-foreground text-right">
            Showing {filtered.length} timesheet{filtered.length !== 1 ? "s" : ""}
            {storeFilter !== "ALL" ? ` for ${stores.find(s => s.id === storeFilter)?.name}` : " across all stores"}
          </p>
        )}
      </div>

      {/* Edit & Approve Modal */}
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
