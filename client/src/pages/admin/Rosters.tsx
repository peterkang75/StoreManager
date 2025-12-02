import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { AdminLayout } from "@/components/layouts/AdminLayout";
import { Button } from "@/components/ui/button";
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
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
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
import { Plus, Calendar, Trash2, ChevronLeft, ChevronRight } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { Store, RosterPeriod, Shift, Employee } from "@shared/schema";

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

function formatTime(time: string): string {
  return time.slice(0, 5);
}

function getMonday(date: Date): string {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  return d.toISOString().split("T")[0];
}

export function AdminRosters() {
  const { toast } = useToast();
  const [selectedStore, setSelectedStore] = useState<string>("");
  const [selectedPeriod, setSelectedPeriod] = useState<RosterPeriod | null>(null);
  const [weekStart, setWeekStart] = useState(() => getMonday(new Date()));
  const [showPeriodDialog, setShowPeriodDialog] = useState(false);
  const [showShiftDialog, setShowShiftDialog] = useState(false);
  const [newPeriodDesc, setNewPeriodDesc] = useState("");
  const [shiftForm, setShiftForm] = useState({
    employeeId: "",
    date: "",
    startTime: "09:00",
    endTime: "17:00",
    role: "",
    notes: "",
  });

  const { data: stores, isLoading: storesLoading } = useQuery<Store[]>({
    queryKey: ["/api/stores"],
  });

  const { data: employees } = useQuery<Employee[]>({
    queryKey: ["/api/employees"],
  });

  const { data: periods } = useQuery<RosterPeriod[]>({
    queryKey: ["/api/roster-periods", selectedStore],
    enabled: !!selectedStore,
  });

  const { data: shifts } = useQuery<Shift[]>({
    queryKey: ["/api/shifts", selectedPeriod?.id],
    enabled: !!selectedPeriod,
  });

  const createPeriodMutation = useMutation({
    mutationFn: async () => {
      if (!selectedStore) throw new Error("Store is required");
      const endDate = new Date(weekStart);
      endDate.setDate(endDate.getDate() + 6);
      const res = await apiRequest("POST", "/api/roster-periods", {
        storeId: selectedStore,
        startDate: weekStart,
        endDate: endDate.toISOString().split("T")[0],
        description: newPeriodDesc || null,
      });
      return res.json();
    },
    onSuccess: (period) => {
      queryClient.invalidateQueries({ queryKey: ["/api/roster-periods"] });
      setSelectedPeriod(period);
      setShowPeriodDialog(false);
      setNewPeriodDesc("");
      toast({ title: "Roster period created" });
    },
    onError: (error: Error) => {
      toast({ title: error.message || "Failed to create roster period", variant: "destructive" });
    },
  });

  const createShiftMutation = useMutation({
    mutationFn: async () => {
      if (!shiftForm.employeeId) throw new Error("Employee is required");
      if (!shiftForm.date) throw new Error("Date is required");
      if (!shiftForm.startTime || !shiftForm.endTime) throw new Error("Shift times are required");
      const res = await apiRequest("POST", "/api/shifts", {
        rosterPeriodId: selectedPeriod?.id,
        storeId: selectedStore,
        employeeId: shiftForm.employeeId,
        date: shiftForm.date,
        startTime: shiftForm.startTime,
        endTime: shiftForm.endTime,
        role: shiftForm.role || null,
        notes: shiftForm.notes || null,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/shifts"] });
      setShowShiftDialog(false);
      setShiftForm({ employeeId: "", date: "", startTime: "09:00", endTime: "17:00", role: "", notes: "" });
      toast({ title: "Shift added" });
    },
    onError: (error: Error) => {
      toast({ title: error.message || "Failed to add shift", variant: "destructive" });
    },
  });

  const deleteShiftMutation = useMutation({
    mutationFn: async (shiftId: string) => {
      await apiRequest("DELETE", `/api/shifts/${shiftId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/shifts"] });
      toast({ title: "Shift deleted" });
    },
    onError: (error: Error) => {
      toast({ title: error.message || "Failed to delete shift", variant: "destructive" });
    },
  });

  const weekDates = getWeekDates(weekStart);
  const activeEmployees = employees?.filter(e => e.status === "ACTIVE" && (!selectedStore || e.storeId === selectedStore)) || [];

  const navigateWeek = (direction: number) => {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + direction * 7);
    setWeekStart(d.toISOString().split("T")[0]);
    setSelectedPeriod(null);
  };

  const getShiftsForCell = (employeeId: string, date: string) => {
    return shifts?.filter(s => s.employeeId === employeeId && s.date === date) || [];
  };

  if (storesLoading) {
    return (
      <AdminLayout title="Rosters">
        <div className="space-y-4">
          <Skeleton className="h-10 w-48" />
          <Skeleton className="h-96 w-full" />
        </div>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout title="Rosters">
      <div className="space-y-6">
        <Card>
          <CardHeader className="pb-4">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-4">
                <div className="w-48">
                  <Select value={selectedStore} onValueChange={setSelectedStore}>
                    <SelectTrigger data-testid="select-store">
                      <SelectValue placeholder="Select store" />
                    </SelectTrigger>
                    <SelectContent>
                      {stores?.filter(s => s.active).map(store => (
                        <SelectItem key={store.id} value={store.id}>{store.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {selectedStore && (
                  <div className="w-64">
                    <Select 
                      value={selectedPeriod?.id || ""} 
                      onValueChange={(id) => setSelectedPeriod(periods?.find(p => p.id === id) || null)}
                    >
                      <SelectTrigger data-testid="select-period">
                        <SelectValue placeholder="Select or create period" />
                      </SelectTrigger>
                      <SelectContent>
                        {periods?.filter(p => p.startDate === weekStart).map(period => (
                          <SelectItem key={period.id} value={period.id}>
                            {period.description || `Week of ${period.startDate}`}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </div>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="icon" onClick={() => navigateWeek(-1)} data-testid="button-prev-week">
                  <ChevronLeft className="w-4 h-4" />
                </Button>
                <span className="text-sm font-medium min-w-[180px] text-center">
                  Week of {new Date(weekStart).toLocaleDateString()}
                </span>
                <Button variant="outline" size="icon" onClick={() => navigateWeek(1)} data-testid="button-next-week">
                  <ChevronRight className="w-4 h-4" />
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {!selectedStore ? (
              <div className="text-center py-12 text-muted-foreground">
                <Calendar className="w-12 h-12 mx-auto mb-4 opacity-50" />
                <p>Select a store to manage rosters</p>
              </div>
            ) : !selectedPeriod ? (
              <div className="text-center py-12">
                <Calendar className="w-12 h-12 mx-auto mb-4 opacity-50 text-muted-foreground" />
                <p className="text-muted-foreground mb-4">No roster period for this week</p>
                <Dialog open={showPeriodDialog} onOpenChange={setShowPeriodDialog}>
                  <DialogTrigger asChild>
                    <Button data-testid="button-create-period">
                      <Plus className="w-4 h-4 mr-2" />
                      Create Roster Period
                    </Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Create Roster Period</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4 py-4">
                      <div className="space-y-2">
                        <Label>Week</Label>
                        <p className="text-sm text-muted-foreground">
                          {new Date(weekStart).toLocaleDateString()} - {new Date(weekDates[6]).toLocaleDateString()}
                        </p>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="period-desc">Description (optional)</Label>
                        <Input
                          id="period-desc"
                          value={newPeriodDesc}
                          onChange={(e) => setNewPeriodDesc(e.target.value)}
                          placeholder="e.g., Holiday week schedule"
                          data-testid="input-period-description"
                        />
                      </div>
                      <Button 
                        onClick={() => createPeriodMutation.mutate()} 
                        disabled={createPeriodMutation.isPending}
                        className="w-full"
                        data-testid="button-save-period"
                      >
                        Create Period
                      </Button>
                    </div>
                  </DialogContent>
                </Dialog>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="flex justify-end">
                  <Dialog open={showShiftDialog} onOpenChange={setShowShiftDialog}>
                    <DialogTrigger asChild>
                      <Button data-testid="button-add-shift">
                        <Plus className="w-4 h-4 mr-2" />
                        Add Shift
                      </Button>
                    </DialogTrigger>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>Add Shift</DialogTitle>
                      </DialogHeader>
                      <div className="space-y-4 py-4">
                        <div className="space-y-2">
                          <Label>Employee</Label>
                          <Select value={shiftForm.employeeId} onValueChange={(v) => setShiftForm({...shiftForm, employeeId: v})}>
                            <SelectTrigger data-testid="select-shift-employee">
                              <SelectValue placeholder="Select employee" />
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
                          <Label>Date</Label>
                          <Select value={shiftForm.date} onValueChange={(v) => setShiftForm({...shiftForm, date: v})}>
                            <SelectTrigger data-testid="select-shift-date">
                              <SelectValue placeholder="Select date" />
                            </SelectTrigger>
                            <SelectContent>
                              {weekDates.map(d => (
                                <SelectItem key={d} value={d}>
                                  {new Date(d).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                          <div className="space-y-2">
                            <Label htmlFor="start-time">Start Time</Label>
                            <Input
                              id="start-time"
                              type="time"
                              value={shiftForm.startTime}
                              onChange={(e) => setShiftForm({...shiftForm, startTime: e.target.value})}
                              data-testid="input-shift-start"
                            />
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor="end-time">End Time</Label>
                            <Input
                              id="end-time"
                              type="time"
                              value={shiftForm.endTime}
                              onChange={(e) => setShiftForm({...shiftForm, endTime: e.target.value})}
                              data-testid="input-shift-end"
                            />
                          </div>
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="role">Role (optional)</Label>
                          <Input
                            id="role"
                            value={shiftForm.role}
                            onChange={(e) => setShiftForm({...shiftForm, role: e.target.value})}
                            placeholder="e.g., Manager, Cashier"
                            data-testid="input-shift-role"
                          />
                        </div>
                        <Button 
                          onClick={() => createShiftMutation.mutate()} 
                          disabled={createShiftMutation.isPending || !shiftForm.employeeId || !shiftForm.date}
                          className="w-full"
                          data-testid="button-save-shift"
                        >
                          Add Shift
                        </Button>
                      </div>
                    </DialogContent>
                  </Dialog>
                </div>

                <div className="overflow-x-auto border rounded-lg">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="min-w-[150px] sticky left-0 bg-background">Employee</TableHead>
                        {weekDates.map(d => (
                          <TableHead key={d} className="min-w-[120px] text-center">
                            {new Date(d).toLocaleDateString("en-US", { weekday: "short", day: "numeric" })}
                          </TableHead>
                        ))}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {activeEmployees.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={8} className="text-center text-muted-foreground py-8">
                            No active employees for this store
                          </TableCell>
                        </TableRow>
                      ) : (
                        activeEmployees.map(emp => (
                          <TableRow key={emp.id} data-testid={`row-employee-${emp.id}`}>
                            <TableCell className="font-medium sticky left-0 bg-background">
                              {emp.firstName} {emp.lastName}
                            </TableCell>
                            {weekDates.map(d => {
                              const cellShifts = getShiftsForCell(emp.id, d);
                              return (
                                <TableCell key={d} className="text-center p-1">
                                  {cellShifts.map(shift => (
                                    <div 
                                      key={shift.id} 
                                      className="bg-primary/10 text-primary text-xs p-1 rounded mb-1 flex items-center justify-between gap-1"
                                    >
                                      <span>{formatTime(shift.startTime)}-{formatTime(shift.endTime)}</span>
                                      <Button 
                                        variant="ghost" 
                                        size="icon" 
                                        className="h-5 w-5"
                                        onClick={() => deleteShiftMutation.mutate(shift.id)}
                                        data-testid={`button-delete-shift-${shift.id}`}
                                      >
                                        <Trash2 className="w-3 h-3" />
                                      </Button>
                                    </div>
                                  ))}
                                </TableCell>
                              );
                            })}
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </AdminLayout>
  );
}
