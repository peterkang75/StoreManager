import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { MobileLayout } from "@/components/layouts/MobileLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { Clock, LogIn, LogOut, CheckCircle2, AlertCircle } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { Store, Employee, TimeLog } from "@shared/schema";

export function MobileClock() {
  const { toast } = useToast();
  const [employeeId, setEmployeeId] = useState<string>("");
  const [storeId, setStoreId] = useState<string>("");

  const { data: stores } = useQuery<Store[]>({
    queryKey: ["/api/stores"],
  });

  const { data: employees, isLoading: employeesLoading } = useQuery<Employee[]>({
    queryKey: ["/api/employees"],
  });

  const today = new Date().toISOString().split("T")[0];

  const { data: timeLogs, isLoading: logsLoading } = useQuery<TimeLog[]>({
    queryKey: ["/api/time-logs", employeeId, storeId, today],
    enabled: !!employeeId && !!storeId,
    queryFn: async () => {
      const params = new URLSearchParams({
        employee_id: employeeId,
        store_id: storeId,
        start_date: today,
        end_date: today,
      });
      const res = await fetch(`/api/time-logs?${params}`);
      if (!res.ok) throw new Error("Failed to fetch time logs");
      return res.json();
    },
    refetchInterval: 30000,
  });

  const clockInMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/time-logs/clock-in", {
        employee_id: employeeId,
        store_id: storeId,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/time-logs"] });
      toast({ title: "Clocked in successfully!" });
    },
    onError: (error: Error) => {
      toast({ title: error.message || "Failed to clock in", variant: "destructive" });
    },
  });

  const clockOutMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/time-logs/clock-out", {
        employee_id: employeeId,
        store_id: storeId,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/time-logs"] });
      toast({ title: "Clocked out successfully!" });
    },
    onError: (error: Error) => {
      toast({ title: error.message || "Failed to clock out", variant: "destructive" });
    },
  });

  const activeEmployees = employees?.filter(e => e.status === "ACTIVE") || [];
  const activeStores = stores?.filter(s => s.active) || [];

  const openLog = timeLogs?.find(log => !log.clockOut);
  const isClockedIn = !!openLog;

  const getTodayLogs = () => {
    return timeLogs?.filter(log => log.clockOut) || [];
  };

  const calculateHours = (clockIn: Date, clockOut: Date | null) => {
    if (!clockOut) return 0;
    return (new Date(clockOut).getTime() - new Date(clockIn).getTime()) / (1000 * 60 * 60);
  };

  const getTotalHoursToday = () => {
    let total = 0;
    for (const log of timeLogs || []) {
      if (log.clockOut) {
        total += calculateHours(log.clockIn, log.clockOut);
      } else {
        total += calculateHours(log.clockIn, new Date());
      }
    }
    return total;
  };

  if (employeesLoading) {
    return (
      <MobileLayout title="Clock In/Out">
        <div className="space-y-4">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-48 w-full" />
        </div>
      </MobileLayout>
    );
  }

  return (
    <MobileLayout title="Clock In/Out">
      <div className="space-y-4">
        <Card>
          <CardContent className="p-4 space-y-4">
            <div className="space-y-2">
              <Label>Employee</Label>
              <Select value={employeeId} onValueChange={setEmployeeId}>
                <SelectTrigger className="h-12 text-base" data-testid="select-employee">
                  <SelectValue placeholder="Select your name" />
                </SelectTrigger>
                <SelectContent>
                  {activeEmployees.map(emp => (
                    <SelectItem key={emp.id} value={emp.id}>
                      {emp.firstName} {emp.lastName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Store</Label>
              <Select value={storeId} onValueChange={setStoreId}>
                <SelectTrigger className="h-12 text-base" data-testid="select-store">
                  <SelectValue placeholder="Select store" />
                </SelectTrigger>
                <SelectContent>
                  {activeStores.map(store => (
                    <SelectItem key={store.id} value={store.id}>
                      {store.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        {employeeId && storeId && (
          <>
            <Card>
              <CardContent className="p-6">
                {logsLoading ? (
                  <div className="flex items-center justify-center py-8">
                    <Skeleton className="h-24 w-24 rounded-full" />
                  </div>
                ) : (
                  <div className="text-center space-y-4">
                    <div className={`w-24 h-24 mx-auto rounded-full flex items-center justify-center ${isClockedIn ? 'bg-green-100' : 'bg-muted'}`}>
                      {isClockedIn ? (
                        <CheckCircle2 className="w-12 h-12 text-green-600" />
                      ) : (
                        <Clock className="w-12 h-12 text-muted-foreground" />
                      )}
                    </div>
                    
                    <div>
                      <p className={`text-lg font-semibold ${isClockedIn ? 'text-green-600' : 'text-muted-foreground'}`}>
                        {isClockedIn ? 'Currently Clocked In' : 'Not Clocked In'}
                      </p>
                      {isClockedIn && openLog && (
                        <p className="text-sm text-muted-foreground">
                          Since {new Date(openLog.clockIn).toLocaleTimeString()}
                        </p>
                      )}
                    </div>

                    <div className="pt-4">
                      {isClockedIn ? (
                        <Button
                          size="lg"
                          variant="destructive"
                          className="w-full h-14 text-lg"
                          onClick={() => clockOutMutation.mutate()}
                          disabled={clockOutMutation.isPending}
                          data-testid="button-clock-out"
                        >
                          <LogOut className="w-5 h-5 mr-2" />
                          Clock Out
                        </Button>
                      ) : (
                        <Button
                          size="lg"
                          className="w-full h-14 text-lg"
                          onClick={() => clockInMutation.mutate()}
                          disabled={clockInMutation.isPending}
                          data-testid="button-clock-in"
                        >
                          <LogIn className="w-5 h-5 mr-2" />
                          Clock In
                        </Button>
                      )}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-4">
                <h3 className="font-semibold mb-3">Today's Summary</h3>
                <div className="flex justify-between items-center p-3 bg-muted rounded-lg">
                  <span className="text-muted-foreground">Total Hours</span>
                  <span className="font-bold text-lg">{getTotalHoursToday().toFixed(2)} hrs</span>
                </div>
                
                {getTodayLogs().length > 0 && (
                  <div className="mt-4 space-y-2">
                    <h4 className="text-sm text-muted-foreground">Completed Sessions</h4>
                    {getTodayLogs().map(log => (
                      <div key={log.id} className="flex justify-between text-sm p-2 bg-muted/50 rounded" data-testid={`log-${log.id}`}>
                        <span>
                          {new Date(log.clockIn).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} - 
                          {log.clockOut && new Date(log.clockOut).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                        <span className="font-medium">
                          {calculateHours(log.clockIn, log.clockOut).toFixed(2)} hrs
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </>
        )}

        {(!employeeId || !storeId) && (
          <div className="text-center py-12 text-muted-foreground">
            <AlertCircle className="w-12 h-12 mx-auto mb-4 opacity-50" />
            <p>Select your name and store to record attendance</p>
          </div>
        )}
      </div>
    </MobileLayout>
  );
}
