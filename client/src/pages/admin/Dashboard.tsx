import { useState, useMemo } from "react";
import { parseVisaDate } from "@/lib/utils";
import { useQuery, useMutation } from "@tanstack/react-query";
import { AdminLayout } from "@/components/layouts/AdminLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SettlementModal, type EnrichedSettlement } from "@/components/admin/SettlementModal";
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
  FileText,
} from "lucide-react";
import { Link } from "wouter";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { Store as StoreType, Candidate, Employee, Todo, UniversalInboxItem, SupplierInvoice } from "@shared/schema";

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

function thisWeekStartYMD(): string {
  const d = new Date(
    new Date().toLocaleString("en-US", { timeZone: "Australia/Sydney" })
  );
  const day = d.getDay(); // 0=Sun
  const diff = day === 0 ? -6 : 1 - day; // back to Monday
  d.setDate(d.getDate() + diff);
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

// ─── Brand design system ─────────────────────────────────────────────────────
const BRAND = {
  sushi:    { sales: "#EE864A", cogs: "#1E3A5F", labour: "#FCD34D" },
  sandwich: { sales: "#D13535", cogs: "#14452F", labour: "#F87171" },
};

// ─── Payroll cycle (2-week) chart helpers ────────────────────────────────────
type DailyRow = { date: string; sales: number; cogs: number; labor: number };
type CycleRow = { cycle: string; sortKey: string; Sales: number; COGS: number; Labour: number };
type StackedRow = {
  cycle: string; sortKey: string;
  SushiSales: number; SandwichSales: number;
  SushiCogs: number;  SandwichCogs: number;
  SushiLabour: number; SandwichLabour: number;
};

function getCycleStart(dateStr: string, anchorStr: string): string {
  const anchor = new Date(anchorStr + "T00:00:00");
  const d      = new Date(dateStr  + "T00:00:00");
  const diff   = Math.floor((d.getTime() - anchor.getTime()) / 86400000);
  const idx    = Math.max(0, Math.floor(diff / 14));
  const cs     = new Date(anchor);
  cs.setDate(anchor.getDate() + idx * 14);
  return cs.toISOString().slice(0, 10);
}

function fmtCycleLabel(isoDate: string): string {
  const d = new Date(isoDate + "T00:00:00");
  return d.toLocaleDateString("en-AU", { day: "numeric", month: "short" });
}

function buildSingleCycles(rows: DailyRow[], anchor: string): CycleRow[] {
  const map = new Map<string, CycleRow>();
  for (const row of rows) {
    const key = getCycleStart(row.date, anchor);
    const cur = map.get(key) ?? { cycle: fmtCycleLabel(key), sortKey: key, Sales: 0, COGS: 0, Labour: 0 };
    cur.Sales  += row.sales  ?? 0;
    cur.COGS   += row.cogs   ?? 0;
    cur.Labour += row.labor  ?? 0;
    map.set(key, cur);
  }
  return Array.from(map.values()).sort((a, b) => a.sortKey.localeCompare(b.sortKey));
}

function buildStackedCycles(sushi: DailyRow[], sandwich: DailyRow[], anchor: string): StackedRow[] {
  const map = new Map<string, StackedRow>();
  const process = (rows: DailyRow[], isSushi: boolean) => {
    for (const row of rows) {
      const key = getCycleStart(row.date, anchor);
      const cur = map.get(key) ?? {
        cycle: fmtCycleLabel(key), sortKey: key,
        SushiSales: 0, SandwichSales: 0,
        SushiCogs: 0,  SandwichCogs: 0,
        SushiLabour: 0, SandwichLabour: 0,
      };
      if (isSushi) {
        cur.SushiSales   += row.sales  ?? 0;
        cur.SushiCogs    += row.cogs   ?? 0;
        cur.SushiLabour  += row.labor  ?? 0;
      } else {
        cur.SandwichSales   += row.sales  ?? 0;
        cur.SandwichCogs    += row.cogs   ?? 0;
        cur.SandwichLabour  += row.labor  ?? 0;
      }
      map.set(key, cur);
    }
  };
  process(sushi, true);
  process(sandwich, false);
  return Array.from(map.values()).sort((a, b) => a.sortKey.localeCompare(b.sortKey));
}

function getVisaDaysLeft(visaExpiry: string | null | undefined): number | null {
  if (!visaExpiry) return null;
  const expiry = parseVisaDate(visaExpiry);
  if (!expiry || isNaN(expiry.getTime())) return null;
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
  dailyTrend: { date: string; sales: number; cogs: number; labor: number }[];
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
  const [selectedTypes, setSelectedTypes] = useState<string[]>(["Sushi", "Sandwich"]);
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
    staleTime: 0,
    refetchOnMount: true,
  });

  const { data: allTriageItems = [], isLoading: triageLoading } = useQuery<UniversalInboxItem[]>({
    queryKey: ["/api/universal-inbox"],
    staleTime: 30_000,
  });

  const { data: reviewInvoices = [], isLoading: reviewLoading } = useQuery<SupplierInvoice[]>({
    queryKey: ["/api/invoices/review"],
    staleTime: 30_000,
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

  const activeStoreList = (stores ?? []).filter(s => s.active);

  const sushiStoreId    = useMemo(() => activeStoreList.find(s => s.name.toLowerCase().includes("sushi"))?.id,    [activeStoreList]);
  const sandwichStoreId = useMemo(() => activeStoreList.find(s => s.name.toLowerCase().includes("sandwich"))?.id, [activeStoreList]);

  const noneSelected = selectedTypes.length === 0;

  const effectiveStoreId = useMemo(() => {
    if (noneSelected || selectedTypes.length === 2) return "ALL";
    const match = activeStoreList.find(s =>
      selectedTypes.some(t => s.name.toLowerCase().includes(t.toLowerCase()))
    );
    return match ? match.id : "ALL";
  }, [noneSelected, selectedTypes, activeStoreList]);

  const params = useMemo(() => {
    const p = new URLSearchParams({ startDate, endDate });
    if (effectiveStoreId !== "ALL") p.set("storeId", effectiveStoreId);
    return p.toString();
  }, [startDate, endDate, effectiveStoreId]);

  const sushiParams = useMemo(() => {
    const p = new URLSearchParams({ startDate, endDate });
    if (sushiStoreId) p.set("storeId", sushiStoreId);
    return p.toString();
  }, [startDate, endDate, sushiStoreId]);

  const sandwichParams = useMemo(() => {
    const p = new URLSearchParams({ startDate, endDate });
    if (sandwichStoreId) p.set("storeId", sandwichStoreId);
    return p.toString();
  }, [startDate, endDate, sandwichStoreId]);

  const { data: summary, isLoading: summaryLoading } = useQuery<DashboardSummary>({
    queryKey: ["/api/dashboard/summary", startDate, endDate, effectiveStoreId],
    queryFn: async () => {
      const res = await fetch(`/api/dashboard/summary?${params}`);
      if (!res.ok) throw new Error("Failed to fetch summary");
      return res.json();
    },
  });

  const { data: sushiSummary } = useQuery<DashboardSummary>({
    queryKey: ["/api/dashboard/summary", startDate, endDate, sushiStoreId],
    queryFn: async () => {
      const res = await fetch(`/api/dashboard/summary?${sushiParams}`);
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    enabled: !!sushiStoreId,
  });

  const { data: sandwichSummary } = useQuery<DashboardSummary>({
    queryKey: ["/api/dashboard/summary", startDate, endDate, sandwichStoreId],
    queryFn: async () => {
      const res = await fetch(`/api/dashboard/summary?${sandwichParams}`);
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    enabled: !!sandwichStoreId,
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

  // ── Chart data — 2-week payroll cycles ───────────────────────────────────
  const isBothSelected    = selectedTypes.includes("Sushi") && selectedTypes.includes("Sandwich");
  const isSushiOnly       = selectedTypes.includes("Sushi") && !selectedTypes.includes("Sandwich");
  const isSandwichOnly    = !selectedTypes.includes("Sushi") && selectedTypes.includes("Sandwich");

  const displaySummary = noneSelected ? null : summary;

  const chartData = useMemo(() => {
    if (noneSelected) return [];
    if (isBothSelected) {
      return buildStackedCycles(sushiSummary?.dailyTrend ?? [], sandwichSummary?.dailyTrend ?? [], startDate);
    }
    if (isSushiOnly)    return buildSingleCycles(sushiSummary?.dailyTrend ?? [], startDate);
    if (isSandwichOnly) return buildSingleCycles(sandwichSummary?.dailyTrend ?? [], startDate);
    return [];
  }, [noneSelected, isBothSelected, isSushiOnly, isSandwichOnly, sushiSummary, sandwichSummary, startDate]);

  // ── Triage: needs routing ─────────────────────────────────────────────────
  const needsRouting = allTriageItems.filter(i => i.status === "NEEDS_ROUTING");

  // ── AP Review: group review invoices by supplier name ─────────────────────
  interface DashReviewGroup {
    key: string;
    supplierName: string;
    count: number;
    total: number;
  }
  const reviewGroupMap = new Map<string, DashReviewGroup>();
  for (const inv of reviewInvoices) {
    const r = inv.rawExtractedData as any;
    const name: string =
      r?.supplier?.supplierName ||
      r?.supplierName ||
      r?.subject?.replace(/^(FWD?:|RE:|Fwd:)\s*/i, "").trim() ||
      inv.notes?.replace(/^(FWD?:|RE:|Fwd:)\s*/i, "").trim() ||
      "Unknown Supplier";
    const key = (r?.abn ? `abn:${r.abn}` : `name:${name}`);
    const prev = reviewGroupMap.get(key);
    if (prev) {
      prev.count += 1;
      prev.total += inv.totalAmount ?? 0;
    } else {
      reviewGroupMap.set(key, { key, supplierName: name, count: 1, total: inv.totalAmount ?? 0 });
    }
  }
  const reviewGroups = Array.from(reviewGroupMap.values());

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
            <Button
              size="sm"
              variant="outline"
              onClick={() => { setStartDate(thisWeekStartYMD()); setEndDate(todayYMD()); }}
              data-testid="button-this-week"
            >
              This Week
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => { setStartDate(firstOfMonthYMD()); setEndDate(todayYMD()); }}
              data-testid="button-this-month"
            >
              This Month
            </Button>
            <div className="flex items-center gap-2 ml-2">
              {(["Sushi", "Sandwich"] as const).map(type => {
                const isOn = selectedTypes.includes(type);
                const brandColor = type === "Sushi" ? BRAND.sushi.sales : BRAND.sandwich.sales;
                return (
                  <button
                    key={type}
                    onClick={() => setSelectedTypes(prev =>
                      prev.includes(type) ? prev.filter(t => t !== type) : [...prev, type]
                    )}
                    className={`px-3 py-1.5 rounded-md text-sm font-medium border transition-colors ${
                      isOn ? "text-white border-transparent" : "border-border text-muted-foreground hover:text-foreground hover:border-foreground/40"
                    }`}
                    style={isOn ? { backgroundColor: brandColor } : {}}
                    data-testid={`button-store-${type.toLowerCase()}`}
                  >
                    {type}
                  </button>
                );
              })}
            </div>
          </div>

          {/* KPI Cards */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <KpiCard
              title="Total Sales"
              amount={displaySummary?.salesTotal ?? 0}
              icon={DollarSign}
              colorClass="bg-blue-500"
              isLoading={summaryLoading && !noneSelected}
              testId="text-kpi-sales"
              subtitle="from daily closings"
            />
            <KpiCard
              title="Total Labor"
              amount={displaySummary?.laborTotal ?? 0}
              percent={displaySummary?.laborPercent}
              icon={Briefcase}
              colorClass="bg-orange-500"
              isLoading={summaryLoading && !noneSelected}
              testId="text-kpi-labor"
            />
            <KpiCard
              title="Total COGS"
              amount={displaySummary?.cogsTotal ?? 0}
              percent={displaySummary?.cogsPercent}
              icon={ShoppingCart}
              colorClass="bg-purple-500"
              isLoading={summaryLoading && !noneSelected}
              testId="text-kpi-cogs"
              subtitle="supplier invoices"
            />
            <KpiCard
              title="Gross Profit"
              amount={displaySummary?.grossProfit ?? 0}
              percent={displaySummary?.grossProfitPercent}
              icon={(displaySummary?.grossProfit ?? 0) >= 0 ? TrendingUp : TrendingDown}
              colorClass={(displaySummary?.grossProfit ?? 0) >= 0 ? "bg-green-500" : "bg-red-500"}
              isLoading={summaryLoading && !noneSelected}
              testId="text-kpi-profit"
              subtitle="Sales − Labor − COGS"
            />
          </div>

          {/* Chart */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">
                {isBothSelected ? "Sales & COGS by Payroll Cycle (Stacked)" : "Sales vs COGS by Payroll Cycle"}
              </CardTitle>
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
                <ResponsiveContainer width="100%" height={240}>
                  <ComposedChart data={chartData} margin={{ top: 4, right: 16, left: 0, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                    <XAxis
                      dataKey="cycle"
                      tick={{ fontSize: 11 }}
                      tickLine={false}
                      axisLine={false}
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
                    {isBothSelected ? (
                      <>
                        <Bar dataKey="SushiSales"      name="Sushi Sales"      fill={BRAND.sushi.sales}      stackId="sales"  radius={[0, 0, 0, 0]} maxBarSize={36} />
                        <Bar dataKey="SandwichSales"   name="Sandwich Sales"   fill={BRAND.sandwich.sales}   stackId="sales"  radius={[3, 3, 0, 0]} maxBarSize={36} />
                        <Bar dataKey="SushiCogs"       name="Sushi COGS"       fill={BRAND.sushi.cogs}       stackId="cogs"   radius={[0, 0, 0, 0]} maxBarSize={36} />
                        <Bar dataKey="SandwichCogs"    name="Sandwich COGS"    fill={BRAND.sandwich.cogs}    stackId="cogs"   radius={[3, 3, 0, 0]} maxBarSize={36} />
                        <Bar dataKey="SushiLabour"     name="Sushi Labour"     fill={BRAND.sushi.labour}     stackId="labour" radius={[0, 0, 0, 0]} maxBarSize={36} />
                        <Bar dataKey="SandwichLabour"  name="Sandwich Labour"  fill={BRAND.sandwich.labour}  stackId="labour" radius={[3, 3, 0, 0]} maxBarSize={36} />
                      </>
                    ) : (
                      <>
                        <Bar dataKey="Sales"  fill={isSandwichOnly ? BRAND.sandwich.sales   : BRAND.sushi.sales}   radius={[3, 3, 0, 0]} maxBarSize={30} />
                        <Bar dataKey="COGS"   fill={isSandwichOnly ? BRAND.sandwich.cogs    : BRAND.sushi.cogs}    radius={[3, 3, 0, 0]} maxBarSize={30} />
                        <Bar dataKey="Labour" fill={isSandwichOnly ? BRAND.sandwich.labour  : BRAND.sushi.labour}  radius={[3, 3, 0, 0]} maxBarSize={30} />
                      </>
                    )}
                  </ComposedChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>
        </section>

        {/* ── Section: Triage — Needs Routing ─────────────────────────── */}
        <section data-testid="section-triage-widget">
          <Card>
            <CardHeader className="flex flex-row items-start justify-between gap-3 flex-wrap pb-4">
              <div>
                <h2 className="text-xl font-semibold tracking-tight flex items-center gap-2">
                  <Mail className="w-5 h-5 text-amber-500" />
                  Needs Routing
                  {needsRouting.length > 0 && (
                    <Badge variant="destructive" className="ml-1" data-testid="badge-triage-count">
                      {needsRouting.length}
                    </Badge>
                  )}
                </h2>
                <p className="text-sm text-muted-foreground mt-0.5">라우팅 규칙이 없는 미처리 이메일</p>
              </div>
              <Link href="/admin/triage">
                <Button variant="outline" size="sm" data-testid="link-view-triage">
                  View Triage Inbox
                  <ChevronRight className="w-3.5 h-3.5 ml-1" />
                </Button>
              </Link>
            </CardHeader>
            <CardContent>
              {triageLoading ? (
                <div className="flex flex-col gap-3">
                  {[1, 2].map((i) => <Skeleton key={i} className="h-14 w-full rounded-lg" />)}
                </div>
              ) : needsRouting.length === 0 ? (
                <div className="flex items-center gap-3 rounded-lg border border-green-500/30 bg-green-500/5 px-4 py-3" data-testid="triage-all-clear">
                  <CheckCircle2 className="h-4 w-4 text-green-600 shrink-0" />
                  <p className="text-sm text-green-700 dark:text-green-400">모든 이메일이 라우팅되었습니다.</p>
                </div>
              ) : (
                <div className="flex flex-col gap-3" data-testid="list-triage-items">
                  {needsRouting.slice(0, 5).map((item) => (
                    <Link key={item.id} href="/admin/triage" className="block">
                      <div
                        className="flex flex-wrap items-center gap-3 rounded-lg border border-border/50 bg-card shadow-sm px-4 py-3 hover:shadow-md transition-shadow cursor-pointer"
                        data-testid={`triage-row-${item.id}`}
                      >
                        <Mail className="w-4 h-4 text-amber-500 shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">
                            {item.senderName || item.senderEmail || "Unknown sender"}
                          </p>
                          <p className="text-xs text-muted-foreground truncate">
                            {item.subject || "No subject"}
                          </p>
                        </div>
                        <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
                      </div>
                    </Link>
                  ))}
                  {needsRouting.length > 5 && (
                    <Link href="/admin/triage">
                      <p className="text-xs text-muted-foreground text-center py-1 hover:text-foreground transition-colors cursor-pointer">
                        + {needsRouting.length - 5} more → View All
                      </p>
                    </Link>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </section>

        {/* ── Section: AP Review Inbox ─────────────────────────────────── */}
        <section data-testid="section-ap-review-widget">
          <Card>
            <CardHeader className="flex flex-row items-start justify-between gap-3 flex-wrap pb-4">
              <div>
                <h2 className="text-xl font-semibold tracking-tight flex items-center gap-2">
                  <FileText className="w-5 h-5 text-blue-500" />
                  AP Review Inbox
                  {reviewGroups.length > 0 && (
                    <Badge className="bg-blue-500 text-white ml-1" data-testid="badge-review-count">
                      {reviewGroups.length}
                    </Badge>
                  )}
                </h2>
                <p className="text-sm text-muted-foreground mt-0.5">인보이스 확인 및 공급업체 등록 대기 중</p>
              </div>
              <Link href="/admin/ap">
                <Button variant="outline" size="sm" data-testid="link-view-ap">
                  View Review Inbox
                  <ChevronRight className="w-3.5 h-3.5 ml-1" />
                </Button>
              </Link>
            </CardHeader>
            <CardContent>
              {reviewLoading ? (
                <div className="flex flex-col gap-3">
                  {[1, 2].map((i) => <Skeleton key={i} className="h-14 w-full rounded-lg" />)}
                </div>
              ) : reviewGroups.length === 0 ? (
                <div className="flex items-center gap-3 rounded-lg border border-green-500/30 bg-green-500/5 px-4 py-3" data-testid="ap-review-all-clear">
                  <CheckCircle2 className="h-4 w-4 text-green-600 shrink-0" />
                  <p className="text-sm text-green-700 dark:text-green-400">검토 대기 중인 인보이스가 없습니다.</p>
                </div>
              ) : (
                <div className="flex flex-col gap-3" data-testid="list-ap-review-items">
                  {reviewGroups.slice(0, 5).map((group) => (
                    <Link key={group.key} href="/admin/ap" className="block">
                      <div
                        className="flex flex-wrap items-center gap-3 rounded-lg border border-border/50 bg-card shadow-sm px-4 py-3 hover:shadow-md transition-shadow cursor-pointer"
                        data-testid={`ap-review-row-${group.key}`}
                      >
                        <FileText className="w-4 h-4 text-blue-500 shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{group.supplierName}</p>
                          <p className="text-xs text-muted-foreground">
                            {group.count} invoice{group.count !== 1 ? "s" : ""}
                            {group.total > 0 ? ` · $${group.total.toFixed(2)}` : ""}
                          </p>
                        </div>
                        <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
                      </div>
                    </Link>
                  ))}
                  {reviewGroups.length > 5 && (
                    <Link href="/admin/ap">
                      <p className="text-xs text-muted-foreground text-center py-1 hover:text-foreground transition-colors cursor-pointer">
                        + {reviewGroups.length - 5} more → View All
                      </p>
                    </Link>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </section>

        {/* ── Section: AI Smart Inbox Summary ────────────────────────── */}
        <section>
          <Card>
            <CardHeader className="flex flex-row items-start justify-between gap-3 flex-wrap pb-4">
              <div>
                <h2 className="text-xl font-semibold tracking-tight flex items-center gap-2">
                  <BrainCircuit className="w-5 h-5 text-primary" />
                  AI Smart Inbox: Critical Action Items
                </h2>
                <p className="text-sm text-muted-foreground mt-0.5">AI가 이메일에서 추출한 긴급 할 일 목록</p>
              </div>
              <Link href="/admin/executive">
                <Button variant="outline" size="sm" data-testid="link-view-all-tasks">
                  View All Tasks
                  <ChevronRight className="w-3.5 h-3.5 ml-1" />
                </Button>
              </Link>
            </CardHeader>
            <CardContent>
          {todosLoading ? (
            <div className="flex flex-col gap-3">
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
            <div className="flex flex-col gap-3" data-testid="list-inbox-tasks">
              {urgentTodos.map((todo) => {
                const overdue = isOverdue(todo.dueDate);
                const dueFmt = fmtTodoDue(todo.dueDate);
                const isMarking = markingDoneId === todo.id;
                return (
                  <div
                    key={todo.id}
                    className="flex flex-wrap items-center gap-3 rounded-lg border border-border/50 bg-card shadow-sm px-4 py-3 hover:shadow-md transition-shadow"
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
            </CardContent>
            </Card>
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

      </div>

      <SettlementModal
        settlement={settlementTarget}
        open={!!settlementTarget}
        onClose={() => setSettlementTarget(null)}
      />
    </AdminLayout>
  );
}
