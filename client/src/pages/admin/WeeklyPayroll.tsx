import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { AdminLayout } from "@/components/layouts/AdminLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DollarSign,
  ChevronLeft,
  ChevronRight,
  Clock,
  Users,
  TrendingUp,
  ArrowLeft,
  CheckCircle2,
  Calendar,
} from "lucide-react";

// ── Week Helpers (AEDT) ───────────────────────────────────────────────────────

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

function fmtHours(h: number): string {
  const hh = Math.floor(h);
  const mm = Math.round((h - hh) * 60);
  return mm === 0 ? `${hh}h` : `${hh}h ${mm}m`;
}

function fmtAUD(amount: number): string {
  return amount.toLocaleString("en-AU", { style: "currency", currency: "AUD" });
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface WeeklyTimesheetRow {
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
  adjustmentReason: string | null;
  isUnscheduled: boolean;
  hours: number;
  rate: number;
  grossPay: number;
}

interface StoreSubtotal {
  storeId: string;
  storeName: string;
  storeCode: string;
  totalHours: number;
  totalGrossPay: number;
  shiftCount: number;
}

interface WeeklyPayrollResponse {
  weekStart: string;
  weekEnd: string;
  timesheets: WeeklyTimesheetRow[];
  storeSubtotals: StoreSubtotal[];
  summary: {
    totalShifts: number;
    totalHours: number;
    totalGrossPay: number;
  };
}

const STORE_COLORS: Record<string, string> = {
  Sushi: "#EE864A",
  Sandwich: "#D13535",
};
function storeColor(name: string): string {
  return STORE_COLORS[name] ?? "#6366f1";
}

// ── Week Navigator ─────────────────────────────────────────────────────────────

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

// ── Store Color Dot ────────────────────────────────────────────────────────────

function StoreDot({ name }: { name: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <div className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: storeColor(name) }} />
      <span className="text-sm font-medium">{name}</span>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export function AdminWeeklyPayroll() {
  const [, navigate] = useLocation();

  // Read weekStart from URL — default to current AEDT Monday
  const thisWeekMonday = getMondayOf(getAEDTToday());
  const urlWeekStart = useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    const ws = params.get("weekStart");
    if (ws && /^\d{4}-\d{2}-\d{2}$/.test(ws)) return getMondayOf(ws);
    return thisWeekMonday;
  }, []);

  const [weekStart, setWeekStart] = useState(urlWeekStart);
  const [storeFilter, setStoreFilter] = useState("ALL");

  const isThisWeek = weekStart === thisWeekMonday;

  const { data, isLoading } = useQuery<WeeklyPayrollResponse>({
    queryKey: ["/api/admin/weekly-payroll", weekStart, storeFilter],
    queryFn: () => {
      const params = new URLSearchParams({ weekStart });
      if (storeFilter !== "ALL") params.set("storeId", storeFilter);
      return fetch(`/api/admin/weekly-payroll?${params}`).then(r => r.json());
    },
    staleTime: 0,
  });

  // Derive unique stores from the full week data for the filter dropdown
  const stores = useMemo(() => {
    if (!data) return [];
    return data.storeSubtotals.map(s => ({ id: s.storeId, name: s.storeName }));
  }, [data]);

  // Group rows by store for display
  const groupedByStore = useMemo(() => {
    if (!data) return [];
    const groups = new Map<string, WeeklyTimesheetRow[]>();
    for (const ts of data.timesheets) {
      if (!groups.has(ts.storeId)) groups.set(ts.storeId, []);
      groups.get(ts.storeId)!.push(ts);
    }
    return Array.from(groups.entries()).map(([storeId, rows]) => ({
      storeId,
      storeName: rows[0].storeName,
      storeCode: rows[0].storeCode,
      rows,
    }));
  }, [data]);

  const navigateTo = (ws: string) => {
    setWeekStart(ws);
    window.history.replaceState({}, "", `/admin/weekly-payroll?weekStart=${ws}`);
  };

  return (
    <AdminLayout title="Weekly Payroll">
      <div className="space-y-4">

        {/* ── Header ──────────────────────────────────────────────────────── */}
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 mb-0.5">
              <Button
                variant="ghost"
                size="sm"
                className="h-8 px-2 -ml-2 text-muted-foreground"
                onClick={() => navigate(`/admin/approvals?weekStart=${weekStart}`)}
                data-testid="button-back-to-approvals"
              >
                <ArrowLeft className="h-4 w-4 mr-1" /> Approvals
              </Button>
            </div>
            <h2 className="text-xl md:text-2xl font-bold tracking-tight flex items-center gap-2">
              <DollarSign className="h-5 w-5 text-primary" />
              Weekly Payroll
            </h2>
            <p className="text-muted-foreground text-xs mt-0.5">주간 급여 요약 — 승인된 타임시트 기준</p>
          </div>

          {/* Store filter */}
          <div className="shrink-0">
            <Select value={storeFilter} onValueChange={setStoreFilter}>
              <SelectTrigger className="h-9 w-40" data-testid="select-store-filter">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All Stores</SelectItem>
                {stores.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* ── Week Navigator ────────────────────────────────────────────────── */}
        <div className="rounded-lg border border-border/40 bg-card px-3 py-2.5">
          <WeekNavigator
            weekStart={weekStart}
            onPrev={() => navigateTo(addDays(weekStart, -7))}
            onNext={() => navigateTo(addDays(weekStart, 7))}
            isThisWeek={isThisWeek}
            onToday={() => navigateTo(thisWeekMonday)}
          />
        </div>

        {/* ── Summary Stats ─────────────────────────────────────────────────── */}
        {isLoading ? (
          <div className="grid grid-cols-3 gap-3">
            {[1, 2, 3].map(i => <Skeleton key={i} className="h-20 rounded-lg" />)}
          </div>
        ) : data && (
          <div className="flex gap-3 overflow-x-auto pb-1 -mx-1 px-1 md:grid md:grid-cols-3 md:overflow-visible">
            {[
              {
                label: "Total Shifts",
                value: data.summary.totalShifts,
                sub: "approved",
                icon: <CheckCircle2 className="h-5 w-5 text-green-600" />,
                color: "border-green-500/40 bg-green-500/5",
                text: "text-green-700 dark:text-green-400",
              },
              {
                label: "Total Hours",
                value: fmtHours(data.summary.totalHours),
                sub: "across all staff",
                icon: <Clock className="h-5 w-5 text-blue-500" />,
                color: "border-blue-400/40 bg-blue-500/5",
                text: "text-blue-700 dark:text-blue-400",
              },
              {
                label: "Total Gross Pay",
                value: fmtAUD(data.summary.totalGrossPay),
                sub: "before tax & super",
                icon: <DollarSign className="h-5 w-5 text-primary" />,
                color: "border-primary/40 bg-primary/5",
                text: "text-primary",
              },
            ].map(item => (
              <div
                key={item.label}
                className={`shrink-0 w-44 md:w-auto rounded-lg border ${item.color} px-4 py-3 flex items-start gap-3`}
                data-testid={`summary-${item.label.toLowerCase().replace(/\s+/g, "-")}`}
              >
                <div className="mt-0.5">{item.icon}</div>
                <div className="min-w-0">
                  <p className="text-[11px] text-muted-foreground font-medium">{item.label}</p>
                  <p className={`text-xl font-black leading-tight ${item.text}`}>{item.value}</p>
                  <p className="text-[10px] text-muted-foreground">{item.sub}</p>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ── Per-store subtotals (only when multiple stores visible) ─────── */}
        {!isLoading && data && data.storeSubtotals.length > 1 && storeFilter === "ALL" && (
          <div className="flex gap-3 overflow-x-auto pb-1 -mx-1 px-1 md:flex-wrap md:overflow-visible">
            {data.storeSubtotals.map(s => (
              <div
                key={s.storeId}
                className="shrink-0 w-44 md:w-auto rounded-lg border border-border/30 bg-card px-4 py-2.5"
                data-testid={`store-subtotal-${s.storeId}`}
              >
                <div className="flex items-center gap-2 mb-1">
                  <div className="h-2 w-2 rounded-full" style={{ backgroundColor: storeColor(s.storeName) }} />
                  <span className="text-xs font-semibold">{s.storeName}</span>
                  <span className="text-[10px] text-muted-foreground ml-auto">{s.shiftCount} shifts</span>
                </div>
                <p className="text-base font-bold text-foreground">{fmtAUD(s.totalGrossPay)}</p>
                <p className="text-[11px] text-muted-foreground">{fmtHours(s.totalHours)}</p>
              </div>
            ))}
          </div>
        )}

        {/* ── Content ──────────────────────────────────────────────────────── */}
        {isLoading ? (
          <div className="space-y-3">
            {[1, 2, 3].map(i => <Skeleton key={i} className="h-36 w-full rounded-xl" />)}
          </div>
        ) : !data || data.timesheets.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center" data-testid="empty-state">
            <DollarSign className="h-12 w-12 text-muted-foreground/30 mb-4" />
            <p className="font-semibold text-muted-foreground">No approved timesheets</p>
            <p className="text-sm text-muted-foreground mt-1">
              No approved shift timesheets were found for this week. Approve timesheets on the Pending Approvals page first.
            </p>
            <Button
              variant="outline"
              size="sm"
              className="mt-4"
              onClick={() => navigate(`/admin/approvals?weekStart=${weekStart}`)}
              data-testid="button-go-to-approvals"
            >
              <CheckCircle2 className="h-4 w-4 mr-2" />
              Go to Pending Approvals
            </Button>
          </div>
        ) : (
          <>
            {/* ── Mobile Card List ── */}
            <div className="md:hidden space-y-6" data-testid="weekly-payroll-cards">
              {groupedByStore.map(group => (
                <div key={group.storeId}>
                  {/* Store header */}
                  <div className="flex items-center gap-2 mb-2 px-1">
                    <div className="h-3 w-3 rounded-full" style={{ backgroundColor: storeColor(group.storeName) }} />
                    <span className="font-bold text-sm">{group.storeName}</span>
                    <span className="text-xs text-muted-foreground ml-auto">
                      {fmtHours(group.rows.reduce((s, r) => s + r.hours, 0))} · {fmtAUD(group.rows.reduce((s, r) => s + r.grossPay, 0))}
                    </span>
                  </div>
                  <div className="space-y-2.5">
                    {group.rows.map(ts => (
                      <div
                        key={ts.id}
                        className="bg-card rounded-xl border border-border/40 border-l-4 px-4 py-3 shadow-sm"
                        style={{ borderLeftColor: storeColor(ts.storeName) }}
                        data-testid={`card-payroll-${ts.id}`}
                      >
                        <div className="flex items-start justify-between gap-3 mb-2">
                          <div>
                            <p className="font-bold text-sm">{ts.employeeNickname || ts.employeeName.split(" ")[0]}</p>
                            <p className="text-[11px] text-muted-foreground">{fmtDate(ts.date)}</p>
                          </div>
                          <div className="text-right">
                            <p className="font-black text-lg text-primary leading-none">{fmtAUD(ts.grossPay)}</p>
                            <p className="text-[10px] text-muted-foreground">{fmtHours(ts.hours)} × ${ts.rate}/hr</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
                          <Clock className="h-3 w-3 shrink-0" />
                          <span>{fmtTime(ts.actualStartTime)} – {fmtTime(ts.actualEndTime)}</span>
                          {ts.isUnscheduled && (
                            <span className="ml-auto text-purple-600 dark:text-purple-400 font-medium italic">Unscheduled</span>
                          )}
                        </div>
                        {ts.adjustmentReason && (
                          <p className="text-[11px] text-muted-foreground mt-1.5 bg-muted/30 rounded px-2 py-1 leading-snug">
                            {ts.adjustmentReason}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            {/* ── Desktop Table ── */}
            <div className="hidden md:block space-y-4" data-testid="weekly-payroll-table">
              {groupedByStore.map(group => {
                const groupHours = group.rows.reduce((s, r) => s + r.hours, 0);
                const groupPay = group.rows.reduce((s, r) => s + r.grossPay, 0);
                return (
                  <Card key={group.storeId}>
                    {/* Store section header */}
                    <div
                      className="flex items-center gap-3 px-4 py-2.5 border-b border-border/40 rounded-t-lg"
                      style={{ borderLeftColor: storeColor(group.storeName), borderLeftWidth: 3 }}
                    >
                      <div className="h-3 w-3 rounded-full shrink-0" style={{ backgroundColor: storeColor(group.storeName) }} />
                      <span className="font-bold text-sm">{group.storeName}</span>
                      <span className="text-xs text-muted-foreground">{group.rows.length} shifts</span>
                      <div className="ml-auto flex items-center gap-6 text-sm">
                        <div className="flex items-center gap-1.5 text-muted-foreground">
                          <Clock className="h-3.5 w-3.5" />
                          <span className="font-semibold">{fmtHours(groupHours)}</span>
                        </div>
                        <div className="flex items-center gap-1.5 font-black text-primary">
                          <DollarSign className="h-3.5 w-3.5" />
                          <span>{fmtAUD(groupPay)}</span>
                        </div>
                      </div>
                    </div>

                    <CardContent className="p-0">
                      <table className="w-full text-left">
                        <thead>
                          <tr className="border-b border-border/20 bg-muted/20">
                            <th className="py-2 px-4 text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Date</th>
                            <th className="py-2 px-3 text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Employee</th>
                            <th className="py-2 px-3 text-[11px] font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap">Time In / Out</th>
                            <th className="py-2 px-3 text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Hours</th>
                            <th className="py-2 px-3 text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Rate</th>
                            <th className="py-2 px-4 text-[11px] font-semibold text-muted-foreground uppercase tracking-wide text-right">Gross Pay</th>
                          </tr>
                        </thead>
                        <tbody>
                          {group.rows.map(ts => (
                            <tr
                              key={ts.id}
                              className="border-b border-border/20 last:border-0 hover:bg-muted/10"
                              data-testid={`row-payroll-${ts.id}`}
                            >
                              <td className="py-2.5 px-4 whitespace-nowrap">
                                <div className="text-sm">{fmtDate(ts.date)}</div>
                              </td>
                              <td className="py-2.5 px-3">
                                <div className="text-sm font-semibold">{ts.employeeNickname || ts.employeeName.split(" ")[0]}</div>
                                <div className="text-[11px] text-muted-foreground truncate max-w-[120px]">{ts.employeeName}</div>
                              </td>
                              <td className="py-2.5 px-3 whitespace-nowrap font-mono text-sm text-muted-foreground">
                                {fmtTime(ts.actualStartTime)} – {fmtTime(ts.actualEndTime)}
                                {ts.isUnscheduled && (
                                  <span className="ml-2 text-[10px] text-purple-600 dark:text-purple-400 font-sans font-medium">Unscheduled</span>
                                )}
                              </td>
                              <td className="py-2.5 px-3 whitespace-nowrap">
                                <span className="text-sm font-semibold">{fmtHours(ts.hours)}</span>
                              </td>
                              <td className="py-2.5 px-3 whitespace-nowrap">
                                <span className="text-sm text-muted-foreground">
                                  {ts.rate > 0 ? `$${ts.rate.toFixed(2)}/hr` : <span className="italic text-destructive/70">No rate</span>}
                                </span>
                              </td>
                              <td className="py-2.5 px-4 whitespace-nowrap text-right">
                                <span className={`text-sm font-bold ${ts.grossPay > 0 ? "text-primary" : "text-muted-foreground italic"}`}>
                                  {ts.grossPay > 0 ? fmtAUD(ts.grossPay) : "—"}
                                </span>
                                {ts.adjustmentReason && (
                                  <div className="text-[10px] text-muted-foreground mt-0.5 max-w-[180px] text-right truncate" title={ts.adjustmentReason}>
                                    {ts.adjustmentReason}
                                  </div>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                        {/* Store total row */}
                        <tfoot>
                          <tr className="bg-muted/30 border-t border-border/40">
                            <td colSpan={3} className="py-2 px-4 text-xs font-semibold text-muted-foreground">{group.storeName} Subtotal</td>
                            <td className="py-2 px-3 text-sm font-bold">{fmtHours(groupHours)}</td>
                            <td className="py-2 px-3" />
                            <td className="py-2 px-4 text-right text-sm font-black text-primary">{fmtAUD(groupPay)}</td>
                          </tr>
                        </tfoot>
                      </table>
                    </CardContent>
                  </Card>
                );
              })}

              {/* Grand Total Row */}
              {data.storeSubtotals.length > 1 && (
                <div className="flex items-center justify-between rounded-lg border border-primary/30 bg-primary/5 px-5 py-3 mt-1">
                  <div className="flex items-center gap-2">
                    <Users className="h-4 w-4 text-primary" />
                    <span className="font-bold text-sm">Total — All Stores</span>
                    <span className="text-xs text-muted-foreground">{data.summary.totalShifts} shifts</span>
                  </div>
                  <div className="flex items-center gap-6">
                    <div className="text-sm font-semibold text-muted-foreground">{fmtHours(data.summary.totalHours)}</div>
                    <div className="text-lg font-black text-primary">{fmtAUD(data.summary.totalGrossPay)}</div>
                  </div>
                </div>
              )}
            </div>
          </>
        )}

        {/* ── Disclaimer ────────────────────────────────────────────────────── */}
        {!isLoading && data && data.timesheets.length > 0 && (
          <p className="text-[11px] text-muted-foreground text-center pt-2">
            Gross pay = Approved hours × Employee hourly rate. Tax, super, and deductions are calculated separately on the Payroll page.
          </p>
        )}
      </div>
    </AdminLayout>
  );
}
