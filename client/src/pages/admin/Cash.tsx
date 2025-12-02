import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AdminLayout } from "@/components/layouts/AdminLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Wallet, Receipt } from "lucide-react";
import type { Store, DailyClosing, CashSalesDetail } from "@shared/schema";

export function AdminCash() {
  const [storeFilter, setStoreFilter] = useState<string>("all");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  const { data: stores } = useQuery<Store[]>({
    queryKey: ["/api/stores"],
  });

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
                <Select value={storeFilter} onValueChange={setStoreFilter}>
                  <SelectTrigger className="w-40" data-testid="select-store-filter">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Stores</SelectItem>
                    {stores?.filter(s => s.active).map(store => (
                      <SelectItem key={store.id} value={store.id}>{store.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <div className="flex items-center gap-2">
                  <Label className="text-sm whitespace-nowrap">From:</Label>
                  <Input
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    className="w-40"
                    data-testid="input-start-date"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <Label className="text-sm whitespace-nowrap">To:</Label>
                  <Input
                    type="date"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    className="w-40"
                    data-testid="input-end-date"
                  />
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
            <TabsTrigger value="cash" data-testid="tab-cash">
              <Wallet className="w-4 h-4 mr-2" />
              Cash Details
            </TabsTrigger>
          </TabsList>

          <TabsContent value="closings">
            <Card>
              <CardContent className="pt-6">
                {!dailyClosings?.length ? (
                  <div className="text-center py-12 text-muted-foreground">
                    <Receipt className="w-12 h-12 mx-auto mb-4 opacity-50" />
                    <p>No daily closing records found</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Date</TableHead>
                          <TableHead>Store</TableHead>
                          <TableHead>Staff</TableHead>
                          <TableHead className="text-right">POS</TableHead>
                          <TableHead className="text-right">UberEats</TableHead>
                          <TableHead className="text-right">DoorDash</TableHead>
                          <TableHead className="text-right">Menulog</TableHead>
                          <TableHead className="text-right">Float</TableHead>
                          <TableHead className="text-right">Credit</TableHead>
                          <TableHead className="text-right">Diff</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {dailyClosings.map(closing => (
                          <TableRow key={closing.id} data-testid={`row-closing-${closing.id}`}>
                            <TableCell>{closing.date}</TableCell>
                            <TableCell>{getStoreName(closing.storeId)}</TableCell>
                            <TableCell className="max-w-[150px] truncate">{closing.staffNames || "-"}</TableCell>
                            <TableCell className="text-right">${closing.posSalesAmount.toFixed(2)}</TableCell>
                            <TableCell className="text-right">${closing.ubereatsAmount.toFixed(2)}</TableCell>
                            <TableCell className="text-right">${closing.doordashAmount.toFixed(2)}</TableCell>
                            <TableCell className="text-right">${closing.menulogAmount.toFixed(2)}</TableCell>
                            <TableCell className="text-right">${closing.floatAmount.toFixed(2)}</TableCell>
                            <TableCell className="text-right">${closing.creditAmount.toFixed(2)}</TableCell>
                            <TableCell className={`text-right font-medium ${closing.differenceAmount !== 0 ? (closing.differenceAmount > 0 ? 'text-green-600' : 'text-red-600') : ''}`}>
                              {closing.differenceAmount !== 0 && (closing.differenceAmount > 0 ? '+' : '')}
                              ${closing.differenceAmount.toFixed(2)}
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

          <TabsContent value="cash">
            <Card>
              <CardContent className="pt-6">
                {!cashSales?.length ? (
                  <div className="text-center py-12 text-muted-foreground">
                    <Wallet className="w-12 h-12 mx-auto mb-4 opacity-50" />
                    <p>No cash sales records found</p>
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
        </Tabs>
      </div>
    </AdminLayout>
  );
}
