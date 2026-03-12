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
  CheckCircle2,
} from "lucide-react";

// ── Week Helpers (local-time safe, AEDT) ──────────────────────────────────────

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

interface EmployeeSummary {
  employeeId: string;
  employeeName: string;
  employeeNickname: string | null;
  storeNames: string[];
  shiftCount: number;
  totalHours: number;
  rate: number;
  grossPay: number;
}

const STORE_COLORS: Record<string, string> = {
  Sushi: "#16a34a",
  Sandwich: "#dc2626",
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

// ── Main Page ─────────────────────────────────────────────────────────────────

export function AdminWeeklyPayroll() {
  const [, navigate] = useLocation();

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

  // Group timesheets by employee — one summary row per person
  const employees = useMemo((): EmployeeSummary[] => {
    if (!data?.timesheets) return [];
    const map = new Map<string, EmployeeSummary>();
    for (const ts of data.timesheets) {
      if (!map.has(ts.employeeId)) {
        map.set(ts.employeeId, {
          employeeId: ts.employeeId,
          employeeName: ts.employeeName,
          employeeNickname: ts.employeeNickname,
          storeNames: [],
          shiftCount: 0,
          totalHours: 0,
          rate: ts.rate,
          grossPay: 0,
        });
      }
      const emp = map.get(ts.employeeId)!;
      emp.shiftCount += 1;
      emp.totalHours = Math.round((emp.totalHours + ts.hours) * 100) / 100;
      emp.grossPay = Math.round((emp.grossPay + ts.grossPay) * 100) / 100;
      if (!emp.storeNames.includes(ts.storeName)) emp.storeNames.push(ts.storeName);
    }
    return Array.from(map.values()).sort((a, b) =>
      (a.employeeNickname || a.employeeName).localeCompare(b.employeeNickname || b.employeeName)
    );
  }, [data]);

  const stores = useMemo(() => data?.storeSubtotals.map(s => ({ id: s.storeId, name: s.storeName })) ?? [], [data]);

  const navigateTo = (ws: string) => {
    setWeekStart(ws);
    window.history.replaceState({}, "", `/admin/weekly-payroll?weekStart=${ws}`);
  };

  return (
    <AdminLayout title="Payroll">
      <div className="space-y-4">

        {/* ── Header ──────────────────────────────────────────────────────── */}
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-xl md:text-2xl font-bold tracking-tight flex items-center gap-2">
              <DollarSign className="h-5 w-5 text-primary" />
              Weekly Payroll
            </h2>
            <p className="text-muted-foreground text-xs mt-0.5">주간 급여 요약 — 승인된 타임시트 기준</p>
          </div>
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
                sub: "approved this week",
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

        {/* ── Table / Empty ─────────────────────────────────────────────────── */}
        {isLoading ? (
          <div className="space-y-2">
            {[1, 2, 3].map(i => <Skeleton key={i} className="h-12 w-full rounded-lg" />)}
          </div>
        ) : !data || employees.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center" data-testid="empty-state">
            <DollarSign className="h-12 w-12 text-muted-foreground/30 mb-4" />
            <p className="font-semibold text-muted-foreground">No approved timesheets</p>
            <p className="text-sm text-muted-foreground mt-1">
              No approved shift timesheets found for this week. Approve timesheets on the Pending Approvals page first.
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
            {/* ── Desktop table ─────────────────────────────────────────────── */}
            <Card className="hidden md:block" data-testid="payroll-table">
              <CardContent className="p-0">
                <table className="w-full text-left">
                  <thead>
                    <tr className="border-b border-border/20 bg-muted/20">
                      <th className="py-2.5 pl-4 text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Employee</th>
                      <th className="py-2.5 px-3 text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Store(s)</th>
                      <th className="py-2.5 px-3 text-[11px] font-semibold text-muted-foreground uppercase tracking-wide text-center">Shifts</th>
                      <th className="py-2.5 px-3 text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Total Hours</th>
                      <th className="py-2.5 px-3 text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Hourly Rate</th>
                      <th className="py-2.5 pr-4 text-[11px] font-semibold text-muted-foreground uppercase tracking-wide text-right">Gross Pay</th>
                    </tr>
                  </thead>
                  <tbody>
                    {employees.map(emp => (
                      <tr
                        key={emp.employeeId}
                        className="border-b border-border/20 last:border-0 hover:bg-muted/10"
                        data-testid={`row-employee-${emp.employeeId}`}
                      >
                        <td className="py-2.5 pl-4">
                          <div className="text-sm font-semibold">{emp.employeeNickname || emp.employeeName.split(" ")[0]}</div>
                          <div className="text-[11px] text-muted-foreground">{emp.employeeName}</div>
                        </td>
                        <td className="py-2.5 px-3">
                          <div className="flex flex-wrap gap-2">
                            {emp.storeNames.map(sn => (
                              <span key={sn} className="flex items-center gap-1 text-xs text-muted-foreground">
                                <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: storeColor(sn) }} />
                                {sn}
                              </span>
                            ))}
                          </div>
                        </td>
                        <td className="py-2.5 px-3 text-center">
                          <span className="text-sm">{emp.shiftCount}</span>
                        </td>
                        <td className="py-2.5 px-3">
                          <span className="text-sm font-semibold">{fmtHours(emp.totalHours)}</span>
                        </td>
                        <td className="py-2.5 px-3">
                          <span className="text-sm text-muted-foreground">
                            {emp.rate > 0
                              ? `$${emp.rate.toFixed(2)}/hr`
                              : <span className="italic text-destructive/70 text-xs">No rate set</span>}
                          </span>
                        </td>
                        <td className="py-2.5 pr-4 text-right">
                          <span className={`text-sm font-bold ${emp.grossPay > 0 ? "text-primary" : "text-muted-foreground"}`}>
                            {emp.grossPay > 0 ? fmtAUD(emp.grossPay) : "—"}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  {/* ── Summary Totals row ────────────────────────────────── */}
                  <tfoot>
                    <tr className="border-t-2 border-border/30 bg-muted/20">
                      <td className="py-2.5 pl-4 text-xs font-semibold text-muted-foreground" colSpan={2}>
                        Weekly Summary Totals
                      </td>
                      <td className="py-2.5 px-3 text-center text-xs font-semibold">{data.summary.totalShifts}</td>
                      <td className="py-2.5 px-3">
                        <span className="text-sm font-bold">{fmtHours(data.summary.totalHours)}</span>
                      </td>
                      <td className="py-2.5 px-3 text-xs text-muted-foreground">Total Weekly Hours</td>
                      <td className="py-2.5 pr-4 text-right">
                        <span className="text-base font-black text-primary">{fmtAUD(data.summary.totalGrossPay)}</span>
                        <div className="text-[10px] text-muted-foreground">Total Weekly Payroll Cost</div>
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </CardContent>
            </Card>

            {/* ── Mobile card list ──────────────────────────────────────────── */}
            <div className="md:hidden space-y-2" data-testid="payroll-cards">
              {employees.map(emp => (
                <div
                  key={emp.employeeId}
                  className="rounded-lg border border-border/40 bg-card px-4 py-3 flex items-center justify-between gap-3"
                  data-testid={`card-employee-${emp.employeeId}`}
                >
                  <div className="min-w-0">
                    <p className="text-sm font-bold truncate">
                      {emp.employeeNickname || emp.employeeName.split(" ")[0]}
                    </p>
                    <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                      {emp.storeNames.map(sn => (
                        <span key={sn} className="flex items-center gap-1 text-[11px] text-muted-foreground">
                          <span className="h-1.5 w-1.5 rounded-full shrink-0" style={{ backgroundColor: storeColor(sn) }} />
                          {sn}
                        </span>
                      ))}
                      <span className="text-[11px] text-muted-foreground">{emp.shiftCount} shifts · {fmtHours(emp.totalHours)}</span>
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-base font-black text-primary">{fmtAUD(emp.grossPay)}</p>
                    <p className="text-[10px] text-muted-foreground">${emp.rate}/hr</p>
                  </div>
                </div>
              ))}
              {/* Mobile totals */}
              <div className="rounded-lg border border-border/30 bg-muted/20 px-4 py-2.5 flex items-center justify-between">
                <div>
                  <p className="text-xs font-semibold text-muted-foreground">Total Weekly Hours</p>
                  <p className="text-sm font-bold">{fmtHours(data.summary.totalHours)}</p>
                </div>
                <div className="text-right">
                  <p className="text-[10px] text-muted-foreground">Total Weekly Payroll Cost</p>
                  <p className="text-base font-black text-primary">{fmtAUD(data.summary.totalGrossPay)}</p>
                </div>
              </div>
            </div>

            <p className="text-[11px] text-muted-foreground text-center pt-1">
              Gross pay = Approved hours × Hourly rate. Tax, super &amp; deductions calculated separately.
            </p>
          </>
        )}
      </div>
    </AdminLayout>
  );
}
