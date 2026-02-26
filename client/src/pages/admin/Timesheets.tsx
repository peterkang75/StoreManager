import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { AdminLayout } from "@/components/layouts/AdminLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { Clock, Check, X, RefreshCw, Eye } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { Store, Timesheet, Employee, TimeLog } from "@shared/schema";

function getStatusBadge(status: string) {
  switch (status) {
    case "APPROVED":
      return <Badge className="bg-green-100 text-green-800 hover:bg-green-100">Approved</Badge>;
    case "REJECTED":
      return <Badge variant="destructive">Rejected</Badge>;
    default:
      return <Badge variant="secondary">Pending</Badge>;
  }
}

export function AdminTimesheets() {
  const { toast } = useToast();
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [storeFilter, setStoreFilter] = useState<string>("all");
  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");
  const [generateStart, setGenerateStart] = useState("");
  const [generateEnd, setGenerateEnd] = useState("");
  const [selectedTimesheet, setSelectedTimesheet] = useState<Timesheet | null>(null);
  const [rejectNotes, setRejectNotes] = useState("");
  const [showRejectDialog, setShowRejectDialog] = useState(false);

  const { data: stores } = useQuery<Store[]>({
    queryKey: ["/api/stores"],
  });

  const { data: employees } = useQuery<Employee[]>({
    queryKey: ["/api/employees"],
  });

  const buildQuery = () => {
    const params = new URLSearchParams();
    if (statusFilter !== "all") params.append("status", statusFilter);
    if (storeFilter !== "all") params.append("store_id", storeFilter);
    if (periodStart) params.append("period_start", periodStart);
    if (periodEnd) params.append("period_end", periodEnd);
    return params.toString();
  };

  const { data: timesheets, isLoading } = useQuery<Timesheet[]>({
    queryKey: ["/api/timesheets", statusFilter, storeFilter, periodStart, periodEnd],
    queryFn: async () => {
      const query = buildQuery();
      const res = await fetch(`/api/timesheets${query ? `?${query}` : ""}`);
      if (!res.ok) throw new Error("Failed to fetch timesheets");
      return res.json();
    },
  });

  const { data: timeLogs } = useQuery<TimeLog[]>({
    queryKey: ["/api/time-logs", selectedTimesheet?.employeeId, selectedTimesheet?.periodStart, selectedTimesheet?.periodEnd],
    enabled: !!selectedTimesheet,
    queryFn: async () => {
      if (!selectedTimesheet) return [];
      const params = new URLSearchParams({
        employee_id: selectedTimesheet.employeeId,
        start_date: selectedTimesheet.periodStart,
        end_date: selectedTimesheet.periodEnd,
      });
      const res = await fetch(`/api/time-logs?${params}`);
      if (!res.ok) throw new Error("Failed to fetch time logs");
      return res.json();
    },
  });

  const generateMutation = useMutation({
    mutationFn: async () => {
      if (!generateStart) throw new Error("Period start date is required");
      if (!generateEnd) throw new Error("Period end date is required");
      const res = await apiRequest("POST", "/api/timesheets/generate", {
        period_start: generateStart,
        period_end: generateEnd,
        store_id: storeFilter !== "all" ? storeFilter : undefined,
      });
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/timesheets"] });
      toast({ title: `Generated ${data.length} timesheet(s)` });
    },
    onError: (error: Error) => {
      toast({ title: error.message || "Failed to generate timesheets", variant: "destructive" });
    },
  });

  const approveMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("PUT", `/api/timesheets/${id}/approve`, {});
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/timesheets"] });
      toast({ title: "Timesheet approved" });
    },
    onError: (error: Error) => {
      toast({ title: error.message || "Failed to approve timesheet", variant: "destructive" });
    },
  });

  const rejectMutation = useMutation({
    mutationFn: async ({ id, notes }: { id: string; notes: string }) => {
      const res = await apiRequest("PUT", `/api/timesheets/${id}/reject`, { notes });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/timesheets"] });
      setShowRejectDialog(false);
      setRejectNotes("");
      toast({ title: "Timesheet rejected" });
    },
    onError: (error: Error) => {
      toast({ title: error.message || "Failed to reject timesheet", variant: "destructive" });
    },
  });

  const getEmployeeName = (employeeId: string) => {
    const emp = employees?.find(e => e.id === employeeId);
    return emp ? `${emp.firstName} ${emp.lastName}` : "Unknown";
  };

  const getStoreName = (storeId: string | null) => {
    if (!storeId) return "-";
    const store = stores?.find(s => s.id === storeId);
    return store?.name || "-";
  };

  if (isLoading) {
    return (
      <AdminLayout title="Timesheets">
        <div className="space-y-4">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-96 w-full" />
        </div>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout title="Timesheets">
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Generate Timesheets</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap items-end gap-4">
              <div className="space-y-2">
                <Label htmlFor="gen-start">Period Start</Label>
                <Input
                  id="gen-start"
                  type="date"
                  value={generateStart}
                  onChange={(e) => setGenerateStart(e.target.value)}
                  data-testid="input-generate-start"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="gen-end">Period End</Label>
                <Input
                  id="gen-end"
                  type="date"
                  value={generateEnd}
                  onChange={(e) => setGenerateEnd(e.target.value)}
                  data-testid="input-generate-end"
                />
              </div>
              <Button 
                onClick={() => generateMutation.mutate()}
                disabled={!generateStart || !generateEnd || generateMutation.isPending}
                data-testid="button-generate-timesheets"
              >
                <RefreshCw className="w-4 h-4 mr-2" />
                Generate
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-4">
              <CardTitle className="text-base">Timesheets</CardTitle>
              <div className="flex flex-wrap items-center gap-4">
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger className="w-32" data-testid="select-status-filter">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Status</SelectItem>
                    <SelectItem value="PENDING">Pending</SelectItem>
                    <SelectItem value="APPROVED">Approved</SelectItem>
                    <SelectItem value="REJECTED">Rejected</SelectItem>
                  </SelectContent>
                </Select>
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
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {!timesheets?.length ? (
              <div className="text-center py-12 text-muted-foreground">
                <Clock className="w-12 h-12 mx-auto mb-4 opacity-50" />
                <p>근무 기록표가 없습니다</p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Employee</TableHead>
                    <TableHead>Store</TableHead>
                    <TableHead>Period</TableHead>
                    <TableHead className="text-right">Hours</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {timesheets.map(sheet => (
                    <TableRow key={sheet.id} data-testid={`row-timesheet-${sheet.id}`}>
                      <TableCell className="font-medium">{getEmployeeName(sheet.employeeId)}</TableCell>
                      <TableCell>{getStoreName(sheet.storeId)}</TableCell>
                      <TableCell>{sheet.periodStart} - {sheet.periodEnd}</TableCell>
                      <TableCell className="text-right">{sheet.totalHours.toFixed(2)}</TableCell>
                      <TableCell>{getStatusBadge(sheet.status)}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-2">
                          <Button 
                            variant="ghost" 
                            size="icon"
                            onClick={() => setSelectedTimesheet(sheet)}
                            data-testid={`button-view-${sheet.id}`}
                          >
                            <Eye className="w-4 h-4" />
                          </Button>
                          {sheet.status === "PENDING" && (
                            <>
                              <Button 
                                variant="ghost" 
                                size="icon"
                                onClick={() => approveMutation.mutate(sheet.id)}
                                data-testid={`button-approve-${sheet.id}`}
                              >
                                <Check className="w-4 h-4 text-green-600" />
                              </Button>
                              <Button 
                                variant="ghost" 
                                size="icon"
                                onClick={() => {
                                  setSelectedTimesheet(sheet);
                                  setShowRejectDialog(true);
                                }}
                                data-testid={`button-reject-${sheet.id}`}
                              >
                                <X className="w-4 h-4 text-red-600" />
                              </Button>
                            </>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      <Dialog open={!!selectedTimesheet && !showRejectDialog} onOpenChange={() => setSelectedTimesheet(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Timesheet Details</DialogTitle>
          </DialogHeader>
          {selectedTimesheet && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-muted-foreground">Employee:</span>
                  <span className="ml-2 font-medium">{getEmployeeName(selectedTimesheet.employeeId)}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Status:</span>
                  <span className="ml-2">{getStatusBadge(selectedTimesheet.status)}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Period:</span>
                  <span className="ml-2 font-medium">{selectedTimesheet.periodStart} - {selectedTimesheet.periodEnd}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Total Hours:</span>
                  <span className="ml-2 font-medium">{selectedTimesheet.totalHours.toFixed(2)}</span>
                </div>
              </div>
              
              <div>
                <h4 className="font-medium mb-2">Time Logs</h4>
                {!timeLogs?.length ? (
                  <p className="text-sm text-muted-foreground">해당 기간의 출퇴근 기록이 없습니다</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Date</TableHead>
                        <TableHead>Clock In</TableHead>
                        <TableHead>Clock Out</TableHead>
                        <TableHead className="text-right">Hours</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {timeLogs.map(log => {
                        const hours = log.clockOut 
                          ? (new Date(log.clockOut).getTime() - new Date(log.clockIn).getTime()) / (1000 * 60 * 60)
                          : 0;
                        return (
                          <TableRow key={log.id}>
                            <TableCell>{new Date(log.clockIn).toLocaleDateString()}</TableCell>
                            <TableCell>{new Date(log.clockIn).toLocaleTimeString()}</TableCell>
                            <TableCell>{log.clockOut ? new Date(log.clockOut).toLocaleTimeString() : "-"}</TableCell>
                            <TableCell className="text-right">{hours.toFixed(2)}</TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={showRejectDialog} onOpenChange={setShowRejectDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject Timesheet</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="reject-notes">Reason for rejection</Label>
              <Textarea
                id="reject-notes"
                value={rejectNotes}
                onChange={(e) => setRejectNotes(e.target.value)}
                placeholder="Enter reason..."
                data-testid="input-reject-notes"
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setShowRejectDialog(false)}>Cancel</Button>
              <Button 
                variant="destructive"
                onClick={() => selectedTimesheet && rejectMutation.mutate({ id: selectedTimesheet.id, notes: rejectNotes })}
                disabled={rejectMutation.isPending}
                data-testid="button-confirm-reject"
              >
                Reject
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
}
