import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { AdminLayout } from "@/components/layouts/AdminLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SettlementModal, type EnrichedSettlement } from "@/components/admin/SettlementModal";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ResponsiveContainer,
  ComposedChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts";
import {
  Store,
  Users,
  UserCheck,
  ClipboardList,
  Smartphone,
  ExternalLink,
  UserPlus,
  KeyRound,
  AlertTriangle,
  ShieldCheck,
  TrendingUp,
  TrendingDown,
  DollarSign,
  ShoppingCart,
  Briefcase,
  ArrowRightLeft,
  BrainCircuit,
  CheckCircle2,
  CalendarClock,
  Mail,
  ChevronRight,
  Loader2,
} from "lucide-react";
import { Link } from "wouter";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { Store as StoreType, Candidate, Employee, Todo } from "@shared/schema";

// ─── helpers ────────────────────────────────────────────────────────────────

function todayYMD(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Australia/Sydney" });
}

function firstOfMonthYMD(): string {
  const d = new Date(
    new Date().toLocaleString("en-US", { timeZone: "Australia/Sydney" })
  );
  d.setDate(1);
  return d.toLocaleDateString("en-CA");
}

function fmtAUD(n: number): string {
  return new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD", maximumFractionDigits: 0 }).format(n);
}

function fmtDate(d: string): string {
  try {
    return new Date(d).toLocaleDateString("en-AU", { day: "2-digit", month: "short" });
  } catch {
    return d;
  }
}

function getVisaDaysLeft(visaExpiry: string | null | undefined): number | null {
  if (!visaExpiry) return null;
  const expiry = new Date(visaExpiry);
  if (isNaN(expiry.getTime())) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.ceil((expiry.getTime() - today.getTime()) / 86400000);
}

// ─── Sub-components ─────────────────────────────────────────────────────────

function StatCard({
  title,
  value,
  icon: Icon,
  href,
  isLoading,
}: {
  title: string;
  value: number | string;
  icon: React.ElementType;
  href: string;
  isLoading?: boolean;
}) {
  return (
    <Link href={href}>
      <Card className="hover-elevate cursor-pointer transition-all">
        <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
          <Icon className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <Skeleton className="h-8 w-16" />
          ) : (
            <div
              className="text-2xl font-bold"
              data-testid={`text-stat-${title.toLowerCase().replace(/\s/g, "-")}`}
            >
              {value}
            </div>
          )}
        </CardContent>
      </Card>
    </Link>
  );
}

interface KpiCardProps {
  title: string;
  amount: number;
  percent?: number;
  icon: React.ElementType;
  colorClass: string;
  isLoading: boolean;
  testId: string;
  subtitle?: string;
  invertTrend?: boolean;
}

function KpiCard({
  title,
  amount,
  percent,
  icon: Icon,
  colorClass,
  isLoading,
  testId,
  subtitle,
  invertTrend,
}: KpiCardProps) {
  const TrendIcon = invertTrend
    ? percent !== undefined && percent > 30
      ? TrendingUp
      : TrendingDown
    : percent !== undefined && percent > 0
    ? TrendingUp
    : TrendingDown;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
        <div className={`p-1.5 rounded-md ${colorClass}`}>
          <Icon className="h-4 w-4 text-white" />
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className="h-9 w-32" />
        ) : (
          <>
            <div className="text-2xl font-bold tabular-nums" data-testid={testId}>
              {fmtAUD(amount)}
            </div>
            {percent !== undefined && (
              <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                <TrendIcon className="h-3 w-3" />
                {percent.toFixed(1)}% of sales
                {subtitle ? ` — ${subtitle}` : ""}
              </p>
            )}
            {percent === undefined && subtitle && (
              <p className="text-xs text-muted-foreground mt-1">{subtitle}</p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Custom Tooltip for chart ────────────────────────────────────────────────

function ChartTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-background border rounded-md shadow-md px-3 py-2 text-sm">
      <p className="font-medium mb-1">{label}</p>
      {payload.map((entry: any) => (
        <p key={entry.name} style={{ color: entry.color }}>
          {entry.name}: {fmtAUD(entry.value)}
        </p>
      ))}
    </div>
  );
}

// ─── Main component ──────────────────────────────────────────────────────────

interface DashboardSummary {
  salesTotal: number;
  laborTotal: number;
  cogsTotal: number;
  grossProfit: number;
  laborPercent: number;
  cogsPercent: number;
  grossProfitPercent: number;
  dailyTrend: { date: string; sales: number; cogs: number }[];
}

function isOverdue(date: string | Date | null): boolean {
  if (!date) return false;
  return new Date(date) < new Date(new Date().toDateString());
}

function fmtTodoDue(date: string | Date | null): string | null {
  if (!date) return null;
  return new Date(date).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" });
}

export function AdminDashboard() {
  const [startDate, setStartDate] = useState(firstOfMonthYMD);
  const [endDate, setEndDate]     = useState(todayYMD);
  const [storeId, setStoreId]     = useState("ALL");
  const [settlementTarget, setSettlementTarget] = useState<EnrichedSettlement | null>(null);
  const [markingDoneId, setMarkingDoneId] = useState<string | null>(null);
  const { toast } = useToast();

  // ── Data queries ──────────────────────────────────────────────────────────
  const { data: stores, isLoading: storesLoading } = useQuery<StoreType[]>({
    queryKey: ["/api/stores"],
  });
  const { data: candidates, isLoading: candidatesLoading } = useQuery<Candidate[]>({
    queryKey: ["/api/candidates"],
  });
  const { data: employees, isLoading: employeesLoading } = useQuery<Employee[]>({
    queryKey: ["/api/employees"],
  });
  const { data: pendingSettlements, isLoading: settlementsLoading } = useQuery<EnrichedSettlement[]>({
    queryKey: ["/api/settlements", "PENDING"],
    queryFn: async () => {
      const res = await fetch("/api/settlements?status=PENDING");
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
  });

  const { data: allTodos = [], isLoading: todosLoading } = useQuery<Todo[]>({
    queryKey: ["/api/todos"],
  });

  const markDoneMutation = useMutation({
    mutationFn: (id: string) => apiRequest("PATCH", `/api/todos/${id}`, { status: "DONE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/todos"] });
      toast({ title: "Task marked as done" });
    },
    onError: () => toast({ title: "Failed to update task", variant: "destructive" }),
    onSettled: () => setMarkingDoneId(null),
  });

  const urgentTodos = allTodos
    .filter((t) => t.status === "TODO" || t.status === "IN_PROGRESS")
    .sort((a, b) => {
      const aOver = isOverdue(a.dueDate);
      const bOver = isOverdue(b.dueDate);
      if (aOver !== bOver) return aOver ? -1 : 1;
      if (a.dueDate && b.dueDate) return new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime();
      if (a.dueDate) return -1;
      if (b.dueDate) return 1;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    })
    .slice(0, 5);

  const params = useMemo(() => {
    const p = new URLSearchParams({ startDate, endDate });
    if (storeId !== "ALL") p.set("storeId", storeId);
    return p.toString();
  }, [startDate, endDate, storeId]);

  const { data: summary, isLoading: summaryLoading } = useQuery<DashboardSummary>({
    queryKey: ["/api/dashboard/summary", startDate, endDate, storeId],
    queryFn: async () => {
      const res = await fetch(`/api/dashboard/summary?${params}`);
      if (!res.ok) throw new Error("Failed to fetch summary");
      return res.json();
    },
  });

  // ── HR stats ──────────────────────────────────────────────────────────────
  const activeStores      = stores?.filter(s => s.active).length ?? 0;
  const pendingCandidates = candidates?.filter(c => c.hireDecision === "PENDING").length ?? 0;
  const activeEmployees   = employees?.filter(e => e.status === "ACTIVE").length ?? 0;
  const recentHires       = candidates?.filter(c => c.hireDecision === "HIRE").length ?? 0;

  const visaAlerts = (employees ?? [])
    .filter(e =>
      e.status === "ACTIVE" &&
      e.visaType &&
      !["CTZ", "PR/CTZ", "PR"].includes(e.visaType)
    )
    .map(e => ({ employee: e, daysLeft: getVisaDaysLeft(e.visaExpiry) }))
    .filter(({ daysLeft }) => daysLeft !== null && daysLeft <= 60)
    .sort((a, b) => (a.daysLeft ?? 999) - (b.daysLeft ?? 999));

  const urgentAlerts = visaAlerts.filter(({ daysLeft }) => daysLeft !== null && daysLeft <= 14);
  const amberAlerts  = visaAlerts.filter(({ daysLeft }) => daysLeft !== null && daysLeft > 14 && daysLeft <= 60);

  // ── Chart data ────────────────────────────────────────────────────────────
  const chartData = (summary?.dailyTrend ?? []).map(row => ({
    date: fmtDate(row.date),
    Sales: row.sales,
    COGS: row.cogs,
  }));

  const activeStoreList = (stores ?? []).filter(s => s.active);

  return (
    <AdminLayout title="Dashboard">
      <div className="space-y-8">

        {/* ── Section: Financial Performance ──────────────────────────── */}
        <section className="space-y-4">
          <div>
            <h2 className="text-xl font-semibold tracking-tight">Financial Performance</h2>
            <p className="text-sm text-muted-foreground">매출, 인건비, 원가 비율 개요</p>
          </div>

          {/* Filters */}
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground whitespace-nowrap">From</span>
              <input
                type="date"
                value={startDate}
                max={endDate}
                onChange={e => setStartDate(e.target.value)}
                className="h-9 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
                data-testid="input-start-date"
              />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground whitespace-nowrap">To</span>
              <input
                type="date"
                value={endDate}
                min={startDate}
                max={todayYMD()}
                onChange={e => setEndDate(e.target.value)}
                className="h-9 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
                data-testid="input-end-date"
              />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground whitespace-nowrap">Store</span>
              <Select value={storeId} onValueChange={setStoreId}>
                <SelectTrigger className="w-36" data-testid="select-store-filter">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All Stores</SelectItem>
                  {activeStoreList.map(s => (
                    <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* KPI Cards */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <KpiCard
              title="Total Sales"
              amount={summary?.salesTotal ?? 0}
              icon={DollarSign}
              colorClass="bg-blue-500"
              isLoading={summaryLoading}
              testId="text-kpi-sales"
              subtitle="from daily closings"
            />
            <KpiCard
              title="Total Labor"
              amount={summary?.laborTotal ?? 0}
              percent={summary?.laborPercent}
              icon={Briefcase}
              colorClass="bg-orange-500"
              isLoading={summaryLoading}
              testId="text-kpi-labor"
            />
            <KpiCard
              title="Total COGS"
              amount={summary?.cogsTotal ?? 0}
              percent={summary?.cogsPercent}
              icon={ShoppingCart}
              colorClass="bg-purple-500"
              isLoading={summaryLoading}
              testId="text-kpi-cogs"
              subtitle="supplier invoices"
            />
            <KpiCard
              title="Gross Profit"
              amount={summary?.grossProfit ?? 0}
              percent={summary?.grossProfitPercent}
              icon={(summary?.grossProfit ?? 0) >= 0 ? TrendingUp : TrendingDown}
              colorClass={(summary?.grossProfit ?? 0) >= 0 ? "bg-green-500" : "bg-red-500"}
              isLoading={summaryLoading}
              testId="text-kpi-profit"
              subtitle="Sales − Labor − COGS"
            />
          </div>

          {/* Chart */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Daily Sales vs COGS</CardTitle>
            </CardHeader>
            <CardContent>
              {summaryLoading ? (
                <div className="flex items-center justify-center h-52 text-sm text-muted-foreground">
                  Loading chart data...
                </div>
              ) : chartData.length === 0 ? (
                <div className="flex items-center justify-center h-52 text-sm text-muted-foreground">
                  No data for the selected period
                </div>
              ) : (
                <ResponsiveContainer width="100%" height={220}>
                  <ComposedChart data={chartData} margin={{ top: 4, right: 16, left: 0, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                    <XAxis
                      dataKey="date"
                      tick={{ fontSize: 11 }}
                      tickLine={false}
                      axisLine={false}
                      interval="preserveStartEnd"
                    />
                    <YAxis
                      tick={{ fontSize: 11 }}
                      tickLine={false}
                      axisLine={false}
                      tickFormatter={v => `$${(v / 1000).toFixed(0)}k`}
                      width={48}
                    />
                    <Tooltip content={<ChartTooltip />} />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Bar dataKey="Sales" fill="#3b82f6" radius={[3, 3, 0, 0]} maxBarSize={32} />
                    <Bar dataKey="COGS"  fill="#a855f7" radius={[3, 3, 0, 0]} maxBarSize={32} />
                  </ComposedChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>
        </section>

        {/* ── Section: HR Overview ─────────────────────────────────────── */}
        <section className="space-y-4">
          <div>
            <h2 className="text-xl font-semibold tracking-tight">Staff Overview</h2>
            <p className="text-sm text-muted-foreground">매장, 후보자, 직원을 한 곳에서 관리하세요.</p>
          </div>

          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <StatCard title="Active Stores"      value={activeStores}      icon={Store}         href="/admin/stores"     isLoading={storesLoading} />
            <StatCard title="Pending Candidates" value={pendingCandidates} icon={Users}         href="/admin/candidates" isLoading={candidatesLoading} />
            <StatCard title="Active Employees"   value={activeEmployees}   icon={UserCheck}     href="/admin/employees"  isLoading={employeesLoading} />
            <StatCard title="Recent Hires"       value={recentHires}       icon={ClipboardList} href="/admin/candidates" isLoading={candidatesLoading} />
          </div>

          {/* Visa compliance alerts */}
          {!employeesLoading && visaAlerts.length > 0 && (
            <Card className="border-orange-400/50" data-testid="compliance-alert-widget">
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-orange-500" />
                  Visa Compliance Alerts
                  {urgentAlerts.length > 0 && (
                    <Badge className="bg-destructive text-destructive-foreground ml-1" data-testid="badge-urgent-count">
                      {urgentAlerts.length} URGENT
                    </Badge>
                  )}
                  {amberAlerts.length > 0 && (
                    <Badge className="bg-orange-500 text-white ml-1" data-testid="badge-amber-count">
                      {amberAlerts.length} Expiring Soon
                    </Badge>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {visaAlerts.map(({ employee: emp, daysLeft }) => {
                  const isUrgent  = daysLeft !== null && daysLeft <= 14;
                  const isExpired = daysLeft !== null && daysLeft <= 0;
                  return (
                    <Link key={emp.id} href={`/admin/employees/${emp.id}`}>
                      <div
                        className={`flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2.5 hover-elevate cursor-pointer ${
                          isUrgent
                            ? "border-destructive/50 bg-destructive/8"
                            : "border-orange-400/40 bg-orange-400/8"
                        }`}
                        data-testid={`compliance-alert-${emp.id}`}
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <AlertTriangle
                            className={`h-4 w-4 shrink-0 ${isUrgent ? "text-destructive" : "text-orange-500"}`}
                          />
                          <div className="min-w-0">
                            <p className={`text-sm font-medium ${isUrgent ? "text-destructive" : "text-orange-700 dark:text-orange-400"}`}>
                              {emp.nickname || emp.firstName} {emp.lastName}
                            </p>
                            <p className="text-xs text-muted-foreground truncate">
                              {emp.visaType}{emp.visaSubclass ? ` (${emp.visaSubclass})` : ""} — Expires: {emp.visaExpiry || "Unknown"}
                            </p>
                          </div>
                        </div>
                        <Badge
                          className={`shrink-0 ${
                            isExpired
                              ? "bg-destructive text-destructive-foreground"
                              : isUrgent
                              ? "bg-destructive/80 text-destructive-foreground"
                              : "bg-orange-500 text-white"
                          }`}
                          data-testid={`badge-visa-status-${emp.id}`}
                        >
                          {isExpired ? "EXPIRED" : `${daysLeft}d left`}
                        </Badge>
                      </div>
                    </Link>
                  );
                })}
              </CardContent>
            </Card>
          )}
          {!employeesLoading && visaAlerts.length === 0 && employees && employees.length > 0 && (
            <div
              className="flex items-center gap-2 rounded-md border border-green-500/30 bg-green-500/8 px-4 py-3"
              data-testid="compliance-all-clear"
            >
              <ShieldCheck className="h-4 w-4 text-green-600 shrink-0" />
              <p className="text-sm text-green-700 dark:text-green-400">
                All visa compliance checks clear — no employees expiring within 60 days.
              </p>
            </div>
          )}
        </section>

        {/* ── Section: Intercompany Settlements ───────────────────────── */}
        {!settlementsLoading && pendingSettlements && pendingSettlements.length > 0 && (
          <section className="space-y-4">
            <div>
              <h2 className="text-xl font-semibold tracking-tight">Intercompany Settlements</h2>
              <p className="text-sm text-muted-foreground">매장 간 인건비 정산 대기 목록</p>
            </div>
            <Card className="border-blue-400/50" data-testid="widget-settlements">
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <ArrowRightLeft className="h-4 w-4 text-blue-500" />
                  Pending Settlements
                  <Badge className="bg-blue-500 text-white ml-1" data-testid="badge-settlement-count">
                    {pendingSettlements.length}
                  </Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {pendingSettlements.map(s => (
                  <div
                    key={s.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-blue-400/30 bg-blue-400/5 px-3 py-2.5"
                    data-testid={`settlement-row-${s.id}`}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <ArrowRightLeft className="h-4 w-4 shrink-0 text-blue-500" />
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-foreground">
                          {s.employeeName}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {s.fromStoreName} → {s.toStoreName}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <span className="text-sm font-semibold text-blue-700 dark:text-blue-400" data-testid={`text-settlement-due-${s.id}`}>
                        ${s.totalAmountDue.toFixed(2)}
                      </span>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setSettlementTarget(s)}
                        data-testid={`button-settle-${s.id}`}
                      >
                        Settle
                      </Button>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          </section>
        )}

        {/* ── Section: Quick Links ─────────────────────────────────────── */}
        <section>
          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Quick Actions</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <Link href="/admin/stores">
                  <div className="flex items-center gap-3 p-3 rounded-md hover-elevate cursor-pointer" data-testid="link-manage-stores">
                    <Store className="h-5 w-5 text-primary" />
                    <div>
                      <p className="font-medium">Manage Stores</p>
                      <p className="text-sm text-muted-foreground">매장 위치 추가 또는 수정</p>
                    </div>
                  </div>
                </Link>
                <Link href="/admin/candidates">
                  <div className="flex items-center gap-3 p-3 rounded-md hover-elevate cursor-pointer" data-testid="link-review-candidates">
                    <Users className="h-5 w-5 text-primary" />
                    <div>
                      <p className="font-medium">Review Candidates</p>
                      <p className="text-sm text-muted-foreground">면접 결과 확인 및 처리</p>
                    </div>
                  </div>
                </Link>
                <Link href="/admin/employees">
                  <div className="flex items-center gap-3 p-3 rounded-md hover-elevate cursor-pointer" data-testid="link-view-employees">
                    <UserCheck className="h-5 w-5 text-primary" />
                    <div>
                      <p className="font-medium">View Employees</p>
                      <p className="text-sm text-muted-foreground">직원 정보 및 상태 관리</p>
                    </div>
                  </div>
                </Link>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <Smartphone className="h-4 w-4" />
                  Mobile Forms
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <Link href="/m/interview">
                  <div className="flex items-center gap-3 p-3 rounded-md hover-elevate cursor-pointer" data-testid="link-mobile-interview">
                    <ClipboardList className="h-5 w-5 text-primary" />
                    <div className="flex-1 min-w-0">
                      <p className="font-medium">Interview Form</p>
                      <p className="text-sm text-muted-foreground">현장 후보자 면접</p>
                    </div>
                    <ExternalLink className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                  </div>
                </Link>
                <Link href="/m/register">
                  <div className="flex items-center gap-3 p-3 rounded-md hover-elevate cursor-pointer" data-testid="link-mobile-register">
                    <UserPlus className="h-5 w-5 text-primary" />
                    <div className="flex-1 min-w-0">
                      <p className="font-medium">Direct Register</p>
                      <p className="text-sm text-muted-foreground">신규 직원 직접 등록</p>
                    </div>
                    <ExternalLink className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                  </div>
                </Link>
                <Link href="/m/portal">
                  <div className="flex items-center gap-3 p-3 rounded-md hover-elevate cursor-pointer" data-testid="link-mobile-portal">
                    <KeyRound className="h-5 w-5 text-primary" />
                    <div className="flex-1 min-w-0">
                      <p className="font-medium">Employee Portal</p>
                      <p className="text-sm text-muted-foreground">직원 출퇴근 타임시트 입력</p>
                    </div>
                    <ExternalLink className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                  </div>
                </Link>
                <div className="p-3 rounded-md bg-muted/50 mt-3">
                  <p className="text-sm text-muted-foreground">
                    직원에게 이 링크를 공유하여 모바일로 접근할 수 있습니다. 온보딩 링크는 Candidates 페이지에서 후보자별로 생성됩니다.
                  </p>
                </div>
              </CardContent>
            </Card>
          </div>
        </section>

        {/* ── Section: AI Smart Inbox Summary ────────────────────────── */}
        <section className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-xl font-semibold tracking-tight flex items-center gap-2">
                <BrainCircuit className="w-5 h-5 text-primary" />
                AI Smart Inbox: Critical Action Items
              </h2>
              <p className="text-sm text-muted-foreground">AI가 이메일에서 추출한 긴급 할 일 목록</p>
            </div>
            <Link href="/admin/executive">
              <Button variant="outline" size="sm" data-testid="link-view-all-tasks">
                View All Tasks
                <ChevronRight className="w-3.5 h-3.5 ml-1" />
              </Button>
            </Link>
          </div>

          {todosLoading ? (
            <div className="space-y-2">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-16 w-full rounded-lg" />
              ))}
            </div>
          ) : urgentTodos.length === 0 ? (
            <div className="flex items-center gap-3 rounded-lg border border-green-500/30 bg-green-500/5 px-4 py-3">
              <CheckCircle2 className="h-4 w-4 text-green-600 shrink-0" />
              <p className="text-sm text-green-700 dark:text-green-400">
                진행 중인 작업이 없습니다. 이메일에서 새 할 일이 감지되면 여기에 표시됩니다.
              </p>
            </div>
          ) : (
            <div className="space-y-2" data-testid="list-inbox-tasks">
              {urgentTodos.map((todo) => {
                const overdue = isOverdue(todo.dueDate);
                const dueFmt = fmtTodoDue(todo.dueDate);
                const isMarking = markingDoneId === todo.id;
                return (
                  <div
                    key={todo.id}
                    className="flex flex-wrap items-center gap-3 rounded-lg border border-border/60 bg-background px-4 py-3 hover:bg-muted/20 transition-colors"
                    data-testid={`inbox-task-${todo.id}`}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2 mb-0.5">
                        {overdue && (
                          <span className="text-xs font-medium text-red-600 dark:text-red-400 shrink-0">OVERDUE</span>
                        )}
                        <span
                          className="text-sm font-medium truncate"
                          data-testid={`text-inbox-title-${todo.id}`}
                        >
                          {todo.title}
                        </span>
                      </div>
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                        {dueFmt && (
                          <span
                            className={`flex items-center gap-1 text-xs ${
                              overdue ? "text-red-600 dark:text-red-400" : "text-muted-foreground"
                            }`}
                            data-testid={`text-inbox-due-${todo.id}`}
                          >
                            <CalendarClock className="w-3 h-3" />
                            {overdue ? "Overdue · " : "Due "}
                            {dueFmt}
                          </span>
                        )}
                        {todo.sourceEmail && (
                          <span
                            className="flex items-center gap-1 text-xs text-muted-foreground truncate max-w-[200px]"
                            data-testid={`text-inbox-source-${todo.id}`}
                          >
                            <Mail className="w-3 h-3 shrink-0" />
                            {todo.sourceEmail}
                          </span>
                        )}
                        {!dueFmt && !todo.sourceEmail && (
                          <span className="text-xs text-muted-foreground">{todo.status === "IN_PROGRESS" ? "In Progress" : "To Do"}</span>
                        )}
                      </div>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={isMarking}
                      onClick={() => {
                        setMarkingDoneId(todo.id);
                        markDoneMutation.mutate(todo.id);
                      }}
                      data-testid={`button-inbox-done-${todo.id}`}
                      className="shrink-0"
                    >
                      {isMarking ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <CheckCircle2 className="w-3.5 h-3.5" />
                      )}
                      Mark Done
                    </Button>
                  </div>
                );
              })}
              {allTodos.filter((t) => t.status !== "DONE").length > 5 && (
                <Link href="/admin/executive">
                  <p className="text-xs text-muted-foreground text-center py-1 hover:text-foreground transition-colors cursor-pointer">
                    + {allTodos.filter((t) => t.status !== "DONE").length - 5} more tasks → View All
                  </p>
                </Link>
              )}
            </div>
          )}
        </section>

      </div>

      <SettlementModal
        settlement={settlementTarget}
        open={!!settlementTarget}
        onClose={() => setSettlementTarget(null)}
      />
    </AdminLayout>
  );
}
