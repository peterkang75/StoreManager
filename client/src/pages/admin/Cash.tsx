import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { AdminLayout } from "@/components/layouts/AdminLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Wallet, Receipt, AlertTriangle, ChevronLeft, ChevronRight } from "lucide-react";
import type { Store, DailyClosing, CashSalesDetail } from "@shared/schema";
import { STORE_COLORS as STORE_BRAND } from "@shared/storeColors";
import { useAdminRole } from "@/contexts/AdminRoleContext";

// ─── Date helpers (local-calendar, no UTC drift) ────────────────────────────
function toYMD(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function getMonday(date: Date): string {
  const d = new Date(date);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return toYMD(d);
}
function addDays(dateStr: string, n: number): string {
  const [y, m, day] = dateStr.split("-").map(Number);
  const d = new Date(y, m - 1, day);
  d.setDate(d.getDate() + n);
  return toYMD(d);
}
function fmtWeekLabel(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short" });
}

export function AdminCash() {
  const { currentRole } = useAdminRole();
  const [storeFilter, setStoreFilter] = useState<string>("all");
  const [weekStart, setWeekStart] = useState<string>(() => getMonday(new Date()));
  const weekEnd = addDays(weekStart, 6);
  const startDate = weekStart;
  const endDate = weekEnd;

  const { data: stores } = useQuery<Store[]>({
    queryKey: ["/api/stores"],
  });

  // Cash & Daily Close is only relevant to Sushi + Sandwich operations.
  const activeStores = useMemo(
    () => (stores ?? []).filter(s => s.active && /sushi|sandwich/i.test(s.name)),
    [stores],
  );

  const buildQuery = () => {
    const params = new URLSearchParams();
    if (storeFilter !== "all") params.append("store_id", storeFilter);
    if (startDate) params.append("start_date", startDate);
    if (endDate) params.append("end_date", endDate);
    return params.toString();
  };

  const { data: dailyClosings, isLoading: closingsLoading } = useQuery<DailyClosing[]>({
    queryKey: ["/api/daily-closings", storeFilter, startDate, endDate],
    queryFn: async () => {
      const query = buildQuery();
      const res = await fetch(`/api/daily-closings${query ? `?${query}` : ""}`);
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json();
    },
  });

  const { data: cashSales, isLoading: cashLoading } = useQuery<CashSalesDetail[]>({
    queryKey: ["/api/cash-sales", storeFilter, startDate, endDate],
    queryFn: async () => {
      const query = buildQuery();
      const res = await fetch(`/api/cash-sales${query ? `?${query}` : ""}`);
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json();
    },
    enabled: currentRole !== "MANAGER",
  });

  const getStoreName = (storeId: string) => {
    return stores?.find(s => s.id === storeId)?.name || "-";
  };

  const isLoading = closingsLoading || cashLoading;

  if (isLoading) {
    return (
      <AdminLayout title="Cash & Daily Close">
        <div className="space-y-4">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-96 w-full" />
        </div>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout title="Cash & Daily Close">
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-4">
              <CardTitle className="text-base">Filter</CardTitle>
              <div className="flex flex-wrap items-center gap-4">
                <div className="flex items-center gap-1 flex-wrap">
                  {[{ id: "all", name: "All Stores" }, ...activeStores].map(store => {
                    const isActive = storeFilter === store.id;
                    const brandColor = STORE_BRAND[store.name] ?? null;
                    return (
                      <button
                        key={store.id}
                        onClick={() => setStoreFilter(store.id)}
                        className={`px-3 py-1.5 rounded-md text-sm font-medium border transition-colors ${
                          isActive ? "text-white border-transparent" : "border-border text-muted-foreground hover:text-foreground hover:border-foreground/40"
                        }`}
                        style={isActive ? { backgroundColor: brandColor ?? "#1a1a1a" } : {}}
                        data-testid={`button-store-filter-${store.id}`}
                      >
                        {store.name}
                      </button>
                    );
                  })}
                </div>
                <div className="flex items-center border rounded-md">
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => setWeekStart(addDays(weekStart, -7))}
                    data-testid="button-prev-week"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <span className="px-2 text-sm font-medium whitespace-nowrap" data-testid="text-week-range">
                    {fmtWeekLabel(weekStart)} – {fmtWeekLabel(weekEnd)}
                  </span>
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => setWeekStart(addDays(weekStart, 7))}
                    data-testid="button-next-week"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </div>
          </CardHeader>
        </Card>

        <Tabs defaultValue="closings">
          <TabsList>
            <TabsTrigger value="closings" data-testid="tab-closings">
              <Receipt className="w-4 h-4 mr-2" />
              Daily Closings
            </TabsTrigger>
            {currentRole !== "MANAGER" && (
              <TabsTrigger value="cash" data-testid="tab-cash">
                <Wallet className="w-4 h-4 mr-2" />
                Cash Details
              </TabsTrigger>
            )}
          </TabsList>

          <TabsContent value="closings">
            <Card>
              <CardContent className="pt-6">
                {!dailyClosings?.length ? (
                  <div className="text-center py-12 text-muted-foreground">
                    <Receipt className="w-12 h-12 mx-auto mb-4 opacity-50" />
                    <p>
                      {currentRole === "MANAGER"
                        ? "No daily closings yet."
                        : "일일 마감 기록이 없습니다"}
                    </p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Date</TableHead>
                          <TableHead>Store</TableHead>
                          <TableHead>Staff</TableHead>
                          <TableHead className="text-right">Prev Float</TableHead>
                          <TableHead className="text-right">Sales Total</TableHead>
                          <TableHead className="text-right">Cash Sales</TableHead>
                          <TableHead className="text-right">Cash Out</TableHead>
                          <TableHead className="text-right">Actual Cash</TableHead>
                          <TableHead className="text-right">Next Float</TableHead>
                          <TableHead className="text-right">UberEats</TableHead>
                          <TableHead className="text-right">DoorDash</TableHead>
                          <TableHead className="text-right">Difference</TableHead>
                          <TableHead className="text-right">Credit</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {dailyClosings.map(closing => {
                          const isShortage = closing.differenceAmount > 0;
                          return (
                            <TableRow key={closing.id} data-testid={`row-closing-${closing.id}`}>
                              <TableCell>{closing.date}</TableCell>
                              <TableCell>{getStoreName(closing.storeId)}</TableCell>
                              <TableCell className="max-w-[150px] truncate">{closing.staffNames || "-"}</TableCell>
                              <TableCell className="text-right">${closing.previousFloat.toFixed(2)}</TableCell>
                              <TableCell className="text-right">${closing.salesTotal.toFixed(2)}</TableCell>
                              <TableCell className="text-right">${closing.cashSales.toFixed(2)}</TableCell>
                              <TableCell className="text-right">${closing.cashOut.toFixed(2)}</TableCell>
                              <TableCell className="text-right">${closing.actualCashCounted.toFixed(2)}</TableCell>
                              <TableCell className="text-right">${closing.nextFloat.toFixed(2)}</TableCell>
                              <TableCell className="text-right">${closing.ubereatsAmount.toFixed(2)}</TableCell>
                              <TableCell className="text-right">${closing.doordashAmount.toFixed(2)}</TableCell>
                              <TableCell className="text-right" data-testid={`text-diff-${closing.id}`}>
                                {isShortage ? (
                                  <span className="inline-flex items-center gap-1 text-red-600 font-bold">
                                    <AlertTriangle className="w-3 h-3" />
                                    ${closing.differenceAmount.toFixed(2)}
                                  </span>
                                ) : closing.differenceAmount < 0 ? (
                                  <span className="text-green-600 font-medium">
                                    -${Math.abs(closing.differenceAmount).toFixed(2)}
                                  </span>
                                ) : (
                                  <span className="text-muted-foreground">$0.00</span>
                                )}
                              </TableCell>
                              <TableCell className="text-right font-medium">${closing.creditAmount.toFixed(2)}</TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {currentRole !== "MANAGER" && (
          <TabsContent value="cash">
            <Card>
              <CardContent className="pt-6">
                {!cashSales?.length ? (
                  <div className="text-center py-12 text-muted-foreground">
                    <Wallet className="w-12 h-12 mx-auto mb-4 opacity-50" />
                    <p>현금 매출 기록이 없습니다</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Date</TableHead>
                          <TableHead>Store</TableHead>
                          <TableHead className="text-right">Envelope</TableHead>
                          <TableHead className="text-right">$100</TableHead>
                          <TableHead className="text-right">$50</TableHead>
                          <TableHead className="text-right">$20</TableHead>
                          <TableHead className="text-right">$10</TableHead>
                          <TableHead className="text-right">$5</TableHead>
                          <TableHead className="text-right">Counted</TableHead>
                          <TableHead className="text-right">Diff</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {cashSales.map(cash => (
                          <TableRow key={cash.id} data-testid={`row-cash-${cash.id}`}>
                            <TableCell>{cash.date}</TableCell>
                            <TableCell>{getStoreName(cash.storeId)}</TableCell>
                            <TableCell className="text-right">${cash.envelopeAmount.toFixed(2)}</TableCell>
                            <TableCell className="text-right">{cash.note100Count}</TableCell>
                            <TableCell className="text-right">{cash.note50Count}</TableCell>
                            <TableCell className="text-right">{cash.note20Count}</TableCell>
                            <TableCell className="text-right">{cash.note10Count}</TableCell>
                            <TableCell className="text-right">{cash.note5Count}</TableCell>
                            <TableCell className="text-right">${cash.countedAmount.toFixed(2)}</TableCell>
                            <TableCell className={`text-right font-medium ${cash.differenceAmount !== 0 ? (cash.differenceAmount > 0 ? 'text-green-600' : 'text-red-600') : ''}`}>
                              {cash.differenceAmount !== 0 && (cash.differenceAmount > 0 ? '+' : '')}
                              ${cash.differenceAmount.toFixed(2)}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
          )}
        </Tabs>
      </div>
    </AdminLayout>
  );
}
