import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { AdminLayout } from "@/components/layouts/AdminLayout";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
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
  ChevronRight,
} from "lucide-react";
import { Link } from "wouter";
import type { Store as StoreType, Candidate, Employee } from "@shared/schema";

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

// ─── Custom Tooltip for chart ────────────────────────────────────────────────

function ChartTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white dark:bg-slate-900 border border-gray-100 dark:border-slate-700 rounded-xl shadow-lg px-4 py-3 text-sm">
      <p className="font-bold text-slate-700 dark:text-slate-300 mb-1">{label}</p>
      {payload.map((entry: any) => (
        <p key={entry.name} style={{ color: entry.color }} className="font-medium">
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

export function AdminDashboard() {
  const [startDate, setStartDate] = useState(firstOfMonthYMD);
  const [endDate, setEndDate]     = useState(todayYMD);
  const [storeId, setStoreId]     = useState("ALL");
  const [settlementTarget, setSettlementTarget] = useState<EnrichedSettlement | null>(null);

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
      <div className="space-y-12">

        {/* ── Hero Header ──────────────────────────────────────────────── */}
        <section>
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
            <div>
              <p className="text-[10px] font-bold tracking-[0.2em] uppercase text-[#FF8C00] mb-2">Business Operations</p>
              <h2 className="text-4xl md:text-5xl font-black tracking-tight leading-tight text-slate-950 dark:text-slate-50">Dashboard</h2>
            </div>
            {!settlementsLoading && pendingSettlements && pendingSettlements.length > 0 && (
              <div className="flex flex-col items-start md:items-end">
                <span className="text-slate-500 text-sm mb-1">Intercompany settlements</span>
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-[#dc2626] animate-pulse"></div>
                  <span className="font-bold text-slate-900 dark:text-slate-100">
                    {pendingSettlements.length} Pending Settlement{pendingSettlements.length !== 1 ? "s" : ""}
                  </span>
                </div>
              </div>
            )}
          </div>
        </section>

        {/* ── Financial Performance ─────────────────────────────────────── */}
        <section className="space-y-6">

          {/* Filters */}
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold tracking-widest uppercase text-slate-400">From</span>
              <input
                type="date"
                value={startDate}
                max={endDate}
                onChange={e => setStartDate(e.target.value)}
                className="h-9 rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-1 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-slate-300"
                data-testid="input-start-date"
              />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold tracking-widest uppercase text-slate-400">To</span>
              <input
                type="date"
                value={endDate}
                min={startDate}
                max={todayYMD()}
                onChange={e => setEndDate(e.target.value)}
                className="h-9 rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-1 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-slate-300"
                data-testid="input-end-date"
              />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold tracking-widest uppercase text-slate-400">Store</span>
              <Select value={storeId} onValueChange={setStoreId}>
                <SelectTrigger className="w-36 rounded-xl border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900" data-testid="select-store-filter">
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

          {/* Bento grid: Total Sales (wide) + Gross Profit (dark) */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">

            {/* Wide card — Total Sales */}
            <div className="md:col-span-2 bg-white dark:bg-slate-900 border border-gray-100 dark:border-slate-800 rounded-2xl p-8 flex flex-col justify-between shadow-sm hover:shadow-md transition-shadow">
              <div className="flex justify-between items-start">
                <DollarSign className="h-9 w-9 text-[#FF8C00]" />
                <span className="text-[10px] font-bold tracking-widest uppercase text-slate-500 py-1.5 px-3 bg-slate-50 dark:bg-slate-800 rounded-full">Total Sales</span>
              </div>
              <div className="mt-8">
                {summaryLoading ? (
                  <Skeleton className="h-12 w-44" />
                ) : (
                  <h3
                    className="text-4xl md:text-5xl font-black tracking-tighter text-slate-950 dark:text-slate-50"
                    data-testid="text-kpi-sales"
                  >
                    {fmtAUD(summary?.salesTotal ?? 0)}
                  </h3>
                )}
                <p className="text-slate-500 mt-3 text-sm leading-relaxed">
                  {fmtDate(startDate)} – {fmtDate(endDate)} · {storeId === "ALL" ? "All Stores" : (stores?.find(s => s.id === storeId)?.name ?? storeId)}
                </p>
              </div>
            </div>

            {/* Dark card — Gross Profit + CTA */}
            <div className="bg-slate-950 text-white rounded-2xl p-8 flex flex-col justify-between relative overflow-hidden shadow-xl">
              <div className="relative z-10">
                <p className="text-[10px] font-bold tracking-widest uppercase text-slate-400 mb-4">Gross Profit</p>
                {summaryLoading ? (
                  <Skeleton className="h-9 w-28 bg-slate-700" />
                ) : (
                  <>
                    <h3
                      className="text-3xl font-black tracking-tight mb-1"
                      data-testid="text-kpi-profit"
                    >
                      {fmtAUD(summary?.grossProfit ?? 0)}
                    </h3>
                    <p className="text-slate-400 text-xs mb-6">
                      {(summary?.grossProfitPercent ?? 0).toFixed(1)}% margin · Sales − Labor − COGS
                    </p>
                  </>
                )}
                <Link href="/admin/approvals">
                  <button className="w-full bg-white text-slate-950 px-4 py-2.5 rounded-xl font-bold text-sm hover:bg-slate-100 transition-all active:scale-95">
                    Review Timesheets →
                  </button>
                </Link>
              </div>
              <div className="absolute -bottom-10 -right-10 w-40 h-40 bg-[#FF8C00]/20 rounded-full blur-3xl pointer-events-none" />
              <div className="absolute -top-10 -left-10 w-40 h-40 bg-[#dc2626]/10 rounded-full blur-3xl pointer-events-none" />
            </div>
          </div>

          {/* Secondary KPI row: Labor + COGS */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

            {/* Labor */}
            <div className="bg-white dark:bg-slate-900 border border-gray-100 dark:border-slate-800 rounded-2xl p-6 shadow-sm hover:shadow-md transition-shadow">
              <div className="flex justify-between items-start mb-6">
                <div className="w-10 h-10 rounded-xl bg-orange-50 dark:bg-orange-950/30 flex items-center justify-center">
                  <Briefcase className="h-5 w-5 text-orange-500" />
                </div>
                <span className="text-[10px] font-bold tracking-widest uppercase text-slate-500 py-1 px-2.5 bg-slate-50 dark:bg-slate-800 rounded-full">Labor Cost</span>
              </div>
              {summaryLoading ? (
                <Skeleton className="h-8 w-28" />
              ) : (
                <>
                  <p className="text-2xl font-black tracking-tight text-slate-950 dark:text-slate-50" data-testid="text-kpi-labor">
                    {fmtAUD(summary?.laborTotal ?? 0)}
                  </p>
                  <p className="text-xs text-slate-400 mt-1.5 flex items-center gap-1">
                    {(summary?.laborPercent ?? 0) > 30
                      ? <TrendingUp className="h-3 w-3 text-orange-400" />
                      : <TrendingDown className="h-3 w-3 text-green-400" />}
                    {(summary?.laborPercent ?? 0).toFixed(1)}% of sales
                  </p>
                </>
              )}
            </div>

            {/* COGS */}
            <div className="bg-white dark:bg-slate-900 border border-gray-100 dark:border-slate-800 rounded-2xl p-6 shadow-sm hover:shadow-md transition-shadow">
              <div className="flex justify-between items-start mb-6">
                <div className="w-10 h-10 rounded-xl bg-purple-50 dark:bg-purple-950/30 flex items-center justify-center">
                  <ShoppingCart className="h-5 w-5 text-purple-500" />
                </div>
                <span className="text-[10px] font-bold tracking-widest uppercase text-slate-500 py-1 px-2.5 bg-slate-50 dark:bg-slate-800 rounded-full">COGS</span>
              </div>
              {summaryLoading ? (
                <Skeleton className="h-8 w-28" />
              ) : (
                <>
                  <p className="text-2xl font-black tracking-tight text-slate-950 dark:text-slate-50" data-testid="text-kpi-cogs">
                    {fmtAUD(summary?.cogsTotal ?? 0)}
                  </p>
                  <p className="text-xs text-slate-400 mt-1.5 flex items-center gap-1">
                    {(summary?.cogsPercent ?? 0) > 30
                      ? <TrendingUp className="h-3 w-3 text-orange-400" />
                      : <TrendingDown className="h-3 w-3 text-green-400" />}
                    {(summary?.cogsPercent ?? 0).toFixed(1)}% of sales · supplier invoices
                  </p>
                </>
              )}
            </div>
          </div>

          {/* Chart */}
          <div className="bg-white dark:bg-slate-900 border border-gray-100 dark:border-slate-800 rounded-2xl p-6 shadow-sm">
            <p className="text-[10px] font-bold tracking-widest uppercase text-slate-400 mb-4">Daily Sales vs COGS</p>
            {summaryLoading ? (
              <div className="flex items-center justify-center h-52 text-sm text-slate-400">Loading chart data...</div>
            ) : chartData.length === 0 ? (
              <div className="flex items-center justify-center h-52 text-sm text-slate-400">No data for the selected period</div>
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <ComposedChart data={chartData} margin={{ top: 4, right: 16, left: 0, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
                  <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} width={48} />
                  <Tooltip content={<ChartTooltip />} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="Sales" fill="#3b82f6" radius={[3, 3, 0, 0]} maxBarSize={32} />
                  <Bar dataKey="COGS" fill="#a855f7" radius={[3, 3, 0, 0]} maxBarSize={32} />
                </ComposedChart>
              </ResponsiveContainer>
            )}
          </div>
        </section>

        {/* ── Staff Overview ────────────────────────────────────────────── */}
        <section className="space-y-6">

          <div>
            <p className="text-[10px] font-bold tracking-[0.2em] uppercase text-slate-400 mb-1">Human Resources</p>
            <h3 className="text-2xl font-black tracking-tight text-slate-950 dark:text-slate-50">Staff Overview</h3>
            <p className="text-sm text-slate-500 mt-0.5">매장, 후보자, 직원을 한 곳에서 관리하세요.</p>
          </div>

          {/* Stat cards grid */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { title: "Active Stores",      value: activeStores,      icon: Store,         href: "/admin/stores",     loading: storesLoading,     testId: "text-stat-active-stores" },
              { title: "Pending Candidates", value: pendingCandidates, icon: Users,         href: "/admin/candidates", loading: candidatesLoading, testId: "text-stat-pending-candidates" },
              { title: "Active Employees",   value: activeEmployees,   icon: UserCheck,     href: "/admin/employees",  loading: employeesLoading,  testId: "text-stat-active-employees" },
              { title: "Recent Hires",       value: recentHires,       icon: ClipboardList, href: "/admin/candidates", loading: candidatesLoading, testId: "text-stat-recent-hires" },
            ].map(({ title, value, icon: Icon, href, loading, testId }) => (
              <Link key={title} href={href}>
                <div className="bg-white dark:bg-slate-900 border border-gray-100 dark:border-slate-800 rounded-2xl p-5 shadow-sm hover:shadow-md transition-shadow cursor-pointer group">
                  <div className="flex justify-between items-start mb-4">
                    <Icon className="h-5 w-5 text-slate-400 group-hover:text-slate-600 dark:group-hover:text-slate-300 transition-colors" />
                    <ChevronRight className="h-4 w-4 text-slate-300 group-hover:text-slate-500 transition-colors" />
                  </div>
                  {loading ? (
                    <Skeleton className="h-8 w-12" />
                  ) : (
                    <p className="text-2xl font-black text-slate-950 dark:text-slate-50" data-testid={testId}>{value}</p>
                  )}
                  <p className="text-[10px] font-bold tracking-widest uppercase text-slate-400 mt-1">{title}</p>
                </div>
              </Link>
            ))}
          </div>

          {/* Visa compliance alerts */}
          {!employeesLoading && visaAlerts.length > 0 && (
            <div className="bg-white dark:bg-slate-900 border border-orange-200 dark:border-orange-900/50 rounded-2xl shadow-sm overflow-hidden" data-testid="compliance-alert-widget">
              <div className="flex items-center gap-3 px-6 py-4 border-b border-orange-100 dark:border-orange-900/30 bg-orange-50/60 dark:bg-orange-950/20">
                <AlertTriangle className="h-5 w-5 text-orange-500 shrink-0" />
                <h4 className="font-bold text-slate-900 dark:text-slate-100 flex-1">Visa Compliance Alerts</h4>
                {urgentAlerts.length > 0 && (
                  <Badge className="bg-red-600 text-white text-[10px] font-black tracking-widest uppercase" data-testid="badge-urgent-count">
                    {urgentAlerts.length} URGENT
                  </Badge>
                )}
                {amberAlerts.length > 0 && (
                  <Badge className="bg-orange-500 text-white text-[10px] font-black tracking-widest uppercase" data-testid="badge-amber-count">
                    {amberAlerts.length} Expiring Soon
                  </Badge>
                )}
              </div>
              <div className="divide-y divide-gray-100 dark:divide-slate-800">
                {visaAlerts.map(({ employee: emp, daysLeft }) => {
                  const isUrgent  = daysLeft !== null && daysLeft <= 14;
                  const isExpired = daysLeft !== null && daysLeft <= 0;
                  return (
                    <Link key={emp.id} href={`/admin/employees/${emp.id}`}>
                      <div
                        className="flex flex-wrap items-center justify-between gap-3 px-6 py-4 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors cursor-pointer"
                        data-testid={`compliance-alert-${emp.id}`}
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${isUrgent ? "bg-red-100 dark:bg-red-950/40" : "bg-orange-100 dark:bg-orange-950/30"}`}>
                            <AlertTriangle className={`h-4 w-4 ${isUrgent ? "text-red-600" : "text-orange-500"}`} />
                          </div>
                          <div className="min-w-0">
                            <p className={`text-sm font-bold ${isUrgent ? "text-red-700 dark:text-red-400" : "text-orange-700 dark:text-orange-400"}`}>
                              {emp.nickname || emp.firstName} {emp.lastName}
                            </p>
                            <p className="text-xs text-slate-400 truncate">
                              {emp.visaType}{emp.visaSubclass ? ` (${emp.visaSubclass})` : ""} · Expires: {emp.visaExpiry || "Unknown"}
                            </p>
                          </div>
                        </div>
                        <Badge
                          className={`shrink-0 text-[10px] font-black tracking-widest uppercase ${
                            isExpired
                              ? "bg-red-600 text-white"
                              : isUrgent
                              ? "bg-red-500 text-white"
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
              </div>
            </div>
          )}

          {!employeesLoading && visaAlerts.length === 0 && employees && employees.length > 0 && (
            <div
              className="flex items-center gap-3 rounded-2xl border border-green-200 dark:border-green-900/50 bg-green-50 dark:bg-green-950/20 px-5 py-4"
              data-testid="compliance-all-clear"
            >
              <ShieldCheck className="h-5 w-5 text-green-600 shrink-0" />
              <p className="text-sm font-medium text-green-700 dark:text-green-400">
                All visa compliance checks clear — no employees expiring within 60 days.
              </p>
            </div>
          )}
        </section>

        {/* ── Intercompany Settlements ──────────────────────────────────── */}
        {!settlementsLoading && pendingSettlements && pendingSettlements.length > 0 && (
          <section className="space-y-4" data-testid="widget-settlements">
            <div className="flex items-center justify-between pb-4 border-b border-gray-100 dark:border-slate-800">
              <div>
                <p className="text-[10px] font-bold tracking-[0.2em] uppercase text-slate-400 mb-0.5">Finance</p>
                <h3 className="text-2xl font-black tracking-tight text-slate-950 dark:text-slate-50">Pending Settlements</h3>
              </div>
              <Badge className="bg-blue-500 text-white text-[10px] font-black tracking-widest uppercase px-3 py-1" data-testid="badge-settlement-count">
                {pendingSettlements.length}
              </Badge>
            </div>

            <div className="space-y-4">
              {pendingSettlements.map(s => {
                const isSushi = (s.fromStoreName?.toLowerCase().includes("sushi") || s.toStoreName?.toLowerCase().includes("sushi"));
                const accentHex = isSushi ? "#16a34a" : "#dc2626";
                return (
                  <div
                    key={s.id}
                    className="group flex flex-col md:flex-row md:items-center justify-between p-5 bg-white dark:bg-slate-900 border border-gray-100 dark:border-slate-800 hover:shadow-lg transition-all rounded-2xl"
                    data-testid={`settlement-row-${s.id}`}
                  >
                    <div className="flex items-center gap-4 mb-4 md:mb-0">
                      <div
                        className="w-11 h-11 rounded-full flex items-center justify-center shrink-0"
                        style={{ backgroundColor: `${accentHex}18`, border: `2px solid ${accentHex}28` }}
                      >
                        <ArrowRightLeft className="h-5 w-5" style={{ color: accentHex }} />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <p className="font-bold text-slate-950 dark:text-slate-50 leading-none">{s.employeeName}</p>
                          <span
                            className="text-[8px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded"
                            style={{ backgroundColor: `${accentHex}18`, color: accentHex }}
                          >
                            {isSushi ? "Sushi" : "Sandwich"}
                          </span>
                        </div>
                        <p className="text-xs text-slate-500 mt-1">{s.fromStoreName} → {s.toStoreName}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-6 md:px-6">
                      <div>
                        <p className="text-[10px] font-bold tracking-widest uppercase text-slate-400 mb-0.5">Amount Due</p>
                        <p className="text-lg font-black tracking-tight text-slate-950 dark:text-slate-50" data-testid={`text-settlement-due-${s.id}`}>
                          ${s.totalAmountDue.toFixed(2)}
                        </p>
                      </div>
                      <button
                        className="px-5 py-2 rounded-xl font-bold text-sm text-white transition-all active:scale-95 hover:opacity-90 shrink-0"
                        style={{ backgroundColor: accentHex }}
                        onClick={() => setSettlementTarget(s)}
                        data-testid={`button-settle-${s.id}`}
                      >
                        Settle
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* ── Quick Access ──────────────────────────────────────────────── */}
        <section className="space-y-4">
          <div className="flex items-center justify-between pb-4 border-b border-gray-100 dark:border-slate-800">
            <div>
              <p className="text-[10px] font-bold tracking-[0.2em] uppercase text-slate-400 mb-0.5">Navigation</p>
              <h3 className="text-2xl font-black tracking-tight text-slate-950 dark:text-slate-50">Quick Access</h3>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

            {/* Management links */}
            <div className="bg-white dark:bg-slate-900 border border-gray-100 dark:border-slate-800 rounded-2xl shadow-sm overflow-hidden">
              <div className="px-6 py-4 border-b border-gray-100 dark:border-slate-800">
                <p className="text-[10px] font-bold tracking-widest uppercase text-slate-400">Management</p>
              </div>
              <div className="divide-y divide-gray-100 dark:divide-slate-800">
                {[
                  { href: "/admin/stores",     icon: Store,     label: "Manage Stores",     sub: "매장 위치 추가 또는 수정",     testId: "link-manage-stores" },
                  { href: "/admin/candidates", icon: Users,     label: "Review Candidates", sub: "면접 결과 확인 및 처리",        testId: "link-review-candidates" },
                  { href: "/admin/employees",  icon: UserCheck, label: "View Employees",    sub: "직원 정보 및 상태 관리",        testId: "link-view-employees" },
                ].map(({ href, icon: Icon, label, sub, testId }) => (
                  <Link key={href} href={href}>
                    <div className="flex items-center gap-4 px-6 py-4 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors cursor-pointer group" data-testid={testId}>
                      <div className="w-9 h-9 rounded-xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center shrink-0 group-hover:bg-slate-200 dark:group-hover:bg-slate-700 transition-colors">
                        <Icon className="h-4 w-4 text-slate-600 dark:text-slate-400" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-bold text-slate-900 dark:text-slate-100 text-sm">{label}</p>
                        <p className="text-xs text-slate-400 truncate">{sub}</p>
                      </div>
                      <ChevronRight className="h-4 w-4 text-slate-300 group-hover:text-slate-500 transition-colors" />
                    </div>
                  </Link>
                ))}
              </div>
            </div>

            {/* Mobile forms */}
            <div className="bg-white dark:bg-slate-900 border border-gray-100 dark:border-slate-800 rounded-2xl shadow-sm overflow-hidden">
              <div className="px-6 py-4 border-b border-gray-100 dark:border-slate-800 flex items-center gap-2">
                <Smartphone className="h-4 w-4 text-slate-400" />
                <p className="text-[10px] font-bold tracking-widest uppercase text-slate-400">Mobile Forms</p>
              </div>
              <div className="divide-y divide-gray-100 dark:divide-slate-800">
                {[
                  { href: "/m/interview", icon: ClipboardList, label: "Interview Form",  sub: "현장 후보자 면접",             testId: "link-mobile-interview" },
                  { href: "/m/register",  icon: UserPlus,      label: "Direct Register", sub: "신규 직원 직접 등록",           testId: "link-mobile-register" },
                  { href: "/m/portal",    icon: KeyRound,      label: "Employee Portal", sub: "직원 출퇴근 타임시트 입력",     testId: "link-mobile-portal" },
                ].map(({ href, icon: Icon, label, sub, testId }) => (
                  <Link key={href} href={href}>
                    <div className="flex items-center gap-4 px-6 py-4 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors cursor-pointer group" data-testid={testId}>
                      <div className="w-9 h-9 rounded-xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center shrink-0 group-hover:bg-slate-200 dark:group-hover:bg-slate-700 transition-colors">
                        <Icon className="h-4 w-4 text-slate-600 dark:text-slate-400" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-bold text-slate-900 dark:text-slate-100 text-sm">{label}</p>
                        <p className="text-xs text-slate-400 truncate">{sub}</p>
                      </div>
                      <ExternalLink className="h-4 w-4 text-slate-300 group-hover:text-slate-500 transition-colors" />
                    </div>
                  </Link>
                ))}
              </div>
              <div className="px-6 py-4 border-t border-gray-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50">
                <p className="text-xs text-slate-400 leading-relaxed">
                  직원에게 이 링크를 공유하여 모바일로 접근할 수 있습니다. 온보딩 링크는 Candidates 페이지에서 후보자별로 생성됩니다.
                </p>
              </div>
            </div>
          </div>
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
