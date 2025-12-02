import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { MobileLayout } from "@/components/layouts/MobileLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Calendar, Clock, ChevronLeft, ChevronRight, MapPin } from "lucide-react";
import type { Store, Employee, Shift } from "@shared/schema";

function getMonday(date: Date): string {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  return d.toISOString().split("T")[0];
}

function getWeekDates(startDate: string): string[] {
  const dates: string[] = [];
  const start = new Date(startDate);
  for (let i = 0; i < 7; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    dates.push(d.toISOString().split("T")[0]);
  }
  return dates;
}

export function MobileRoster() {
  const [employeeId, setEmployeeId] = useState<string>("");
  const [weekStart, setWeekStart] = useState(() => getMonday(new Date()));

  const { data: stores } = useQuery<Store[]>({
    queryKey: ["/api/stores"],
  });

  const { data: employees, isLoading: employeesLoading } = useQuery<Employee[]>({
    queryKey: ["/api/employees"],
  });

  const weekEnd = (() => {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + 6);
    return d.toISOString().split("T")[0];
  })();

  const { data: shifts, isLoading: shiftsLoading } = useQuery<Shift[]>({
    queryKey: ["/api/shifts", employeeId, weekStart, weekEnd],
    enabled: !!employeeId,
    queryFn: async () => {
      const params = new URLSearchParams({
        employee_id: employeeId,
        start_date: weekStart,
        end_date: weekEnd,
      });
      const res = await fetch(`/api/shifts?${params}`);
      if (!res.ok) throw new Error("Failed to fetch shifts");
      return res.json();
    },
  });

  const getStoreName = (storeId: string) => {
    return stores?.find(s => s.id === storeId)?.name || "Unknown";
  };

  const navigateWeek = (direction: number) => {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + direction * 7);
    setWeekStart(d.toISOString().split("T")[0]);
  };

  const weekDates = getWeekDates(weekStart);
  const activeEmployees = employees?.filter(e => e.status === "ACTIVE") || [];

  const getShiftsForDate = (date: string) => {
    return shifts?.filter(s => s.date === date) || [];
  };

  if (employeesLoading) {
    return (
      <MobileLayout title="My Roster">
        <div className="space-y-4">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-48 w-full" />
        </div>
      </MobileLayout>
    );
  }

  return (
    <MobileLayout title="My Roster">
      <div className="space-y-4">
        <Card>
          <CardContent className="p-4 space-y-4">
            <div className="space-y-2">
              <Label>Select Employee</Label>
              <Select value={employeeId} onValueChange={setEmployeeId}>
                <SelectTrigger className="h-12 text-base" data-testid="select-employee">
                  <SelectValue placeholder="Choose your name" />
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
          </CardContent>
        </Card>

        {employeeId && (
          <>
            <div className="flex items-center justify-between">
              <Button variant="ghost" size="icon" onClick={() => navigateWeek(-1)} data-testid="button-prev-week">
                <ChevronLeft className="w-5 h-5" />
              </Button>
              <span className="font-medium text-center">
                {new Date(weekStart).toLocaleDateString("en-US", { month: "short", day: "numeric" })} - {new Date(weekEnd).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
              </span>
              <Button variant="ghost" size="icon" onClick={() => navigateWeek(1)} data-testid="button-next-week">
                <ChevronRight className="w-5 h-5" />
              </Button>
            </div>

            {shiftsLoading ? (
              <div className="space-y-3">
                {[...Array(3)].map((_, i) => (
                  <Skeleton key={i} className="h-20 w-full" />
                ))}
              </div>
            ) : (
              <div className="space-y-3">
                {weekDates.map(date => {
                  const dayShifts = getShiftsForDate(date);
                  const isToday = date === new Date().toISOString().split("T")[0];
                  
                  return (
                    <Card key={date} className={isToday ? "ring-2 ring-primary" : ""}>
                      <CardContent className="p-4">
                        <div className="flex items-center justify-between mb-2">
                          <span className={`font-semibold ${isToday ? "text-primary" : ""}`}>
                            {new Date(date).toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" })}
                          </span>
                          {isToday && (
                            <span className="text-xs bg-primary text-primary-foreground px-2 py-0.5 rounded">Today</span>
                          )}
                        </div>
                        
                        {dayShifts.length === 0 ? (
                          <p className="text-muted-foreground text-sm">No shifts scheduled</p>
                        ) : (
                          <div className="space-y-2">
                            {dayShifts.map(shift => (
                              <div key={shift.id} className="flex items-center gap-3 p-2 bg-muted rounded-lg" data-testid={`shift-${shift.id}`}>
                                <Clock className="w-4 h-4 text-muted-foreground" />
                                <span className="font-medium">{shift.startTime.slice(0,5)} - {shift.endTime.slice(0,5)}</span>
                                <div className="flex items-center gap-1 text-muted-foreground text-sm">
                                  <MapPin className="w-3 h-3" />
                                  {getStoreName(shift.storeId)}
                                </div>
                                {shift.role && (
                                  <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded">{shift.role}</span>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )}
          </>
        )}

        {!employeeId && (
          <div className="text-center py-12 text-muted-foreground">
            <Calendar className="w-12 h-12 mx-auto mb-4 opacity-50" />
            <p>Select your name to view your shifts</p>
          </div>
        )}
      </div>
    </MobileLayout>
  );
}
