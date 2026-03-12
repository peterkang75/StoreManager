import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { AdminLayout } from "@/components/layouts/AdminLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { History, Clock, ChevronLeft, ChevronRight, CheckCircle2, XCircle, HelpCircle } from "lucide-react";
import type { Store } from "@shared/schema";

// ── Date Helpers (local-time safe) ───────────────────────────────────────────

function getAEDTToday(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Australia/Sydney" });
}

function toYMD(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function getMondayOf(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return toYMD(d);
}

function addDays(dateStr: string, n: number): string {
  const d = new Date(dateStr + "T00:00:00");
  d.setDate(d.getDate() + n);
  return toYMD(d);
}

function fmtWeekDate(dateStr: string): string {
  return new Date(dateStr + "T00:00:00").toLocaleDateString("en-AU", {
    day: "2-digit", month: "short", year: "numeric",
  });
}

function fmtDate(dateStr: string): string {
  return new Date(dateStr + "T00:00:00").toLocaleDateString("en-AU", {
    weekday: "short", day: "numeric", month: "short",
  });
}

function fmtTime(t: string | null): string {
  if (!t) return "—";
  const [h, m] = t.split(":").map(Number);
  const period = h >= 12 ? "PM" : "AM";
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${period}`;
}

function calcHours(start: string, end: string): number {
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  const diff = (eh * 60 + em) - (sh * 60 + sm);
  return Math.round((diff < 0 ? diff + 1440 : diff) / 60 * 100) / 100;
}

function fmtHours(h: number): string {
  const hh = Math.floor(h);
  const mm = Math.round((h - hh) * 60);
  return mm === 0 ? `${hh}h` : `${hh}h ${mm}m`;
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface ShiftTimesheetRow {
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
  status: "PENDING" | "APPROVED" | "REJECTED";
  adjustmentReason: string | null;
  isUnscheduled: boolean;
  scheduledStartTime: string | null;
  scheduledEndTime: string | null;
}

const STORE_COLORS: Record<string, string> = {
  Sushi: "#16a34a",
  Sandwich: "#dc2626",
};
function storeColor(name: string): string {
  return STORE_COLORS[name] ?? "#6366f1";
}

// ── Status Badge ──────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  if (status === "APPROVED") {
    return (
      <Badge className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400 gap-1 whitespace-nowrap">
        <CheckCircle2 className="h-3 w-3" /> Approved
      </Badge>
    );
  }
  if (status === "REJECTED") {
    return (
      <Badge variant="destructive" className="gap-1 whitespace-nowrap">
        <XCircle className="h-3 w-3" /> Rejected
      </Badge>
    );
  }
  return (
    <Badge variant="secondary" className="gap-1 whitespace-nowrap">
      <HelpCircle className="h-3 w-3" /> Pending
    </Badge>
  );
}

// ── Week Navigator ────────────────────────────────────────────────────────────

function WeekNavigator({
  weekStart, onPrev, onNext, isThisWeek, onToday,
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
      <Button size="icon" variant="outline" className="h-9 w-9 shrink-0" onClick={onPrev} data-testid="button-week-prev">
        <ChevronLeft className="h-4 w-4" />
      </Button>
      <div className="flex-1 text-center min-w-0">
        <p className="text-sm font-semibold leading-tight whitespace-nowrap">
          {fmtWeekDate(weekStart)} – {fmtWeekDate(weekEnd)}
        </p>
        <p className="text-[10px] text-muted-foreground">Mon – Sun (AEDT)</p>
      </div>
      <Button size="icon" variant="outline" className="h-9 w-9 shrink-0" onClick={onNext} data-testid="button-week-next">
        <ChevronRight className="h-4 w-4" />
      </Button>
      {!isThisWeek && (
        <Button variant="outline" size="sm" className="shrink-0 h-9 text-xs" onClick={onToday} data-testid="button-week-today">
          This Week
        </Button>
      )}
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export function AdminTimesheets() {
  const thisWeekMonday = getMondayOf(getAEDTToday());
  const [weekStart, setWeekStart] = useState(thisWeekMonday);
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [storeFilter, setStoreFilter] = useState<string>("ALL");

  const weekEnd = addDays(weekStart, 6);
  const isThisWeek = weekStart === thisWeekMonday;

  const { data: stores } = useQuery<Store[]>({ queryKey: ["/api/stores"] });

  // Re-use the approvals API — pass status=ALL to get every record regardless of status
  const { data: allRows = [], isLoading } = useQuery<ShiftTimesheetRow[]>({
    queryKey: ["/api/admin/approvals", "ALL"],
    queryFn: () => fetch("/api/admin/approvals?status=ALL").then(r => r.json()),
    staleTime: 0,
  });

  // Client-side filter: week + status + store
  const filtered = useMemo(() => {
    return allRows.filter(r => {
      if (r.date < weekStart || r.date > weekEnd) return false;
      if (statusFilter !== "ALL" && r.status !== statusFilter) return false;
      if (storeFilter !== "ALL" && r.storeId !== storeFilter) return false;
      return true;
    });
  }, [allRows, weekStart, weekEnd, statusFilter, storeFilter]);

  // Summary counts
  const counts = useMemo(() => {
    const base = allRows.filter(r => r.date >= weekStart && r.date <= weekEnd);
    return {
      total: base.length,
      approved: base.filter(r => r.status === "APPROVED").length,
      pending: base.filter(r => r.status === "PENDING").length,
      rejected: base.filter(r => r.status === "REJECTED").length,
    };
  }, [allRows, weekStart, weekEnd]);

  // Total hours of filtered rows
  const totalHours = useMemo(() =>
    filtered.reduce((s, r) => s + calcHours(r.actualStartTime, r.actualEndTime), 0),
    [filtered]
  );

  // Active stores from data
  const activeStores = useMemo(() => {
    const ids = new Set(allRows.map(r => r.storeId));
    return (stores || []).filter(s => ids.has(s.id) && s.active);
  }, [stores, allRows]);

  return (
    <AdminLayout title="Attendance History">
      <div className="space-y-4">

        {/* ── Header ───────────────────────────────────────────────────────── */}
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-xl md:text-2xl font-bold tracking-tight flex items-center gap-2">
              <History className="h-5 w-5 text-primary" />
              Attendance History
            </h2>
            <p className="text-muted-foreground text-xs mt-0.5">전체 근무 기록 — 승인된 항목 포함</p>
          </div>

          {/* Filters */}
          <div className="flex gap-2 flex-wrap">
            <Select value={storeFilter} onValueChange={setStoreFilter}>
              <SelectTrigger className="h-9 w-36" data-testid="select-store-filter">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All Stores</SelectItem>
                {activeStores.map(s => (
                  <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="h-9 w-36" data-testid="select-status-filter">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All Status</SelectItem>
                <SelectItem value="APPROVED">Approved</SelectItem>
                <SelectItem value="PENDING">Pending</SelectItem>
                <SelectItem value="REJECTED">Rejected</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* ── Week Navigator ────────────────────────────────────────────────── */}
        <div className="rounded-lg border border-border/40 bg-card px-3 py-2.5">
          <WeekNavigator
            weekStart={weekStart}
            onPrev={() => setWeekStart(addDays(weekStart, -7))}
            onNext={() => setWeekStart(addDays(weekStart, 7))}
            isThisWeek={isThisWeek}
            onToday={() => setWeekStart(thisWeekMonday)}
          />
        </div>

        {/* ── Summary Stats ─────────────────────────────────────────────────── */}
        {isLoading ? (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-16 rounded-lg" />)}
          </div>
        ) : (
          <div className="flex gap-3 overflow-x-auto pb-1 -mx-1 px-1 md:grid md:grid-cols-4 md:overflow-visible">
            {[
              { label: "Total Shifts", value: counts.total, color: "text-foreground" },
              { label: "Approved", value: counts.approved, color: "text-green-600 dark:text-green-400" },
              { label: "Pending", value: counts.pending, color: "text-amber-600 dark:text-amber-400" },
              { label: "Rejected", value: counts.rejected, color: "text-destructive" },
            ].map(item => (
              <div
                key={item.label}
                className="shrink-0 w-36 md:w-auto rounded-lg border border-border/30 bg-card px-4 py-2.5"
                data-testid={`stat-${item.label.toLowerCase().replace(/\s+/g, "-")}`}
              >
                <p className="text-[11px] text-muted-foreground">{item.label}</p>
                <p className={`text-2xl font-black leading-tight ${item.color}`}>{item.value}</p>
              </div>
            ))}
          </div>
        )}

        {/* ── Content ──────────────────────────────────────────────────────── */}
        {isLoading ? (
          <div className="space-y-2">
            {[1, 2, 3].map(i => <Skeleton key={i} className="h-14 w-full rounded-lg" />)}
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <Clock className="h-12 w-12 text-muted-foreground/30 mb-4" />
            <p className="font-semibold text-muted-foreground">근무 기록표가 없습니다</p>
            <p className="text-sm text-muted-foreground mt-1">
              {statusFilter !== "ALL"
                ? `No ${statusFilter.toLowerCase()} records for this week.`
                : "No attendance records found for this week."}
            </p>
          </div>
        ) : (
          <>
            {/* Mobile Card List */}
            <div className="md:hidden space-y-2.5" data-testid="history-cards">
              {filtered.map(r => {
                const hours = calcHours(r.actualStartTime, r.actualEndTime);
                return (
                  <div
                    key={r.id}
                    className="rounded-xl border border-border/40 border-l-4 bg-card px-4 py-3 shadow-sm"
                    style={{ borderLeftColor: storeColor(r.storeName) }}
                    data-testid={`card-history-${r.id}`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-bold text-sm">{r.employeeNickname || r.employeeName.split(" ")[0]}</span>
                          <span className="text-[11px] text-muted-foreground">{r.storeName}</span>
                          {r.isUnscheduled && (
                            <span className="text-[10px] text-purple-600 dark:text-purple-400 italic">Unscheduled</span>
                          )}
                        </div>
                        <p className="text-[11px] text-muted-foreground mt-0.5">{fmtDate(r.date)}</p>
                        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground mt-1">
                          <Clock className="h-3 w-3" />
                          <span>{fmtTime(r.actualStartTime)} – {fmtTime(r.actualEndTime)}</span>
                          <span className="text-foreground font-semibold">({fmtHours(hours)})</span>
                        </div>
                      </div>
                      <StatusBadge status={r.status} />
                    </div>
                    {r.adjustmentReason && (
                      <p className="text-[11px] text-muted-foreground mt-1.5 bg-muted/30 rounded px-2 py-1 leading-snug">
                        {r.adjustmentReason}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Desktop Table */}
            <Card className="hidden md:block" data-testid="history-table">
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/20">
                      <TableHead className="pl-4 py-2.5 text-[11px] uppercase tracking-wide">Date</TableHead>
                      <TableHead className="py-2.5 text-[11px] uppercase tracking-wide">Employee</TableHead>
                      <TableHead className="py-2.5 text-[11px] uppercase tracking-wide">Store</TableHead>
                      <TableHead className="py-2.5 text-[11px] uppercase tracking-wide">Time In</TableHead>
                      <TableHead className="py-2.5 text-[11px] uppercase tracking-wide">Time Out</TableHead>
                      <TableHead className="py-2.5 text-[11px] uppercase tracking-wide">Hours</TableHead>
                      <TableHead className="py-2.5 pr-4 text-[11px] uppercase tracking-wide">Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filtered.map(r => {
                      const hours = calcHours(r.actualStartTime, r.actualEndTime);
                      return (
                        <TableRow key={r.id} data-testid={`row-history-${r.id}`}>
                          <TableCell className="pl-4 py-2.5 whitespace-nowrap text-sm">{fmtDate(r.date)}</TableCell>
                          <TableCell className="py-2.5">
                            <div className="text-sm font-semibold">{r.employeeNickname || r.employeeName.split(" ")[0]}</div>
                            <div className="text-[11px] text-muted-foreground">{r.employeeName}</div>
                          </TableCell>
                          <TableCell className="py-2.5">
                            <div className="flex items-center gap-1.5">
                              <div className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: storeColor(r.storeName) }} />
                              <span className="text-sm">{r.storeName}</span>
                              {r.isUnscheduled && (
                                <span className="text-[10px] text-purple-600 dark:text-purple-400 italic ml-1">Unscheduled</span>
                              )}
                            </div>
                          </TableCell>
                          <TableCell className="py-2.5 font-mono text-sm">{fmtTime(r.actualStartTime)}</TableCell>
                          <TableCell className="py-2.5 font-mono text-sm">{fmtTime(r.actualEndTime)}</TableCell>
                          <TableCell className="py-2.5">
                            <span className="text-sm font-semibold">{fmtHours(hours)}</span>
                          </TableCell>
                          <TableCell className="py-2.5 pr-4">
                            <div className="space-y-1">
                              <StatusBadge status={r.status} />
                              {r.adjustmentReason && (
                                <p className="text-[10px] text-muted-foreground max-w-[200px] truncate" title={r.adjustmentReason}>
                                  {r.adjustmentReason}
                                </p>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>

                {/* Footer summary */}
                <div className="flex items-center justify-between px-4 py-2.5 border-t border-border/30 bg-muted/20">
                  <span className="text-xs text-muted-foreground">{filtered.length} records</span>
                  <span className="text-sm font-bold">
                    Total: <span className="text-primary">{fmtHours(totalHours)}</span>
                  </span>
                </div>
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </AdminLayout>
  );
}
