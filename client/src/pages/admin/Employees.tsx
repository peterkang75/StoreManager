import { useState, useCallback, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { AdminLayout } from "@/components/layouts/AdminLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
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
import { UserCheck, Search } from "lucide-react";
import { useLocation } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { Employee, Store, EmployeeStoreAssignment } from "@shared/schema";
import { STORE_COLORS as STORE_BRAND } from "@shared/storeColors";
import { useAdminRole } from "@/contexts/AdminRoleContext";

export function AdminEmployees() {
  const { currentRole } = useAdminRole();
  const isManager = currentRole === "MANAGER";
  const [, setLocation] = useLocation();
  const [searchTerm, setSearchTerm] = useState("");
  const [storeFilter, setStoreFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("ACTIVE");
  const { toast } = useToast();

  const { data: employees, isLoading: employeesLoading } = useQuery<Employee[]>({
    queryKey: ["/api/employees"],
  });

  const { data: stores } = useQuery<Store[]>({
    queryKey: ["/api/stores"],
  });

  const { data: assignments } = useQuery<EmployeeStoreAssignment[]>({
    queryKey: ["/api/employee-store-assignments"],
  });

  const storeMap = new Map(stores?.map(s => [s.id, s]) ?? []);

  const empStoreMap = useMemo(() => {
    const map = new Map<string, string[]>();
    if (!assignments) return map;
    for (const a of assignments) {
      const list = map.get(a.employeeId) || [];
      list.push(a.storeId);
      map.set(a.employeeId, list);
    }
    return map;
  }, [assignments]);

  const getStoreNames = (employeeId: string) => {
    const storeIds = empStoreMap.get(employeeId);
    if (!storeIds || storeIds.length === 0) return "—";
    return storeIds
      .map(sid => storeMap.get(sid)?.name ?? "Unknown")
      .join(", ");
  };

  const STORE_ORDER: Record<string, number> = { Sushi: 0, Sandwich: 1, HO: 2 };

  const getStorePriority = (employeeId: string): number => {
    const storeIds = empStoreMap.get(employeeId) || [];
    if (storeIds.length === 0) return 99;
    const priorities = storeIds.map(sid => {
      const name = storeMap.get(sid)?.name ?? "";
      return STORE_ORDER[name] ?? 3;
    });
    return Math.min(...priorities);
  };

  const filteredEmployees = employees?.filter((e) => {
    const matchesSearch =
      e.firstName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      e.lastName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      e.nickname?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      e.email?.toLowerCase().includes(searchTerm.toLowerCase());
    const empStores = empStoreMap.get(e.id) || [];
    const matchesStore = storeFilter === "all" || empStores.includes(storeFilter);
    const matchesStatus = statusFilter === "all" || e.status === statusFilter;
    return matchesSearch && matchesStore && matchesStatus;
  }).sort((a, b) => {
    const pa = getStorePriority(a.id);
    const pb = getStorePriority(b.id);
    if (pa !== pb) return pa - pb;
    return (a.nickname || a.firstName).localeCompare(b.nickname || b.firstName);
  });

  const handleRowClick = (employee: Employee) => {
    setLocation(`/admin/employees/${employee.id}`);
  };

  const toggleStatus = useCallback(
    async (e: React.MouseEvent, employee: Employee) => {
      e.stopPropagation();
      const newStatus = employee.status === "ACTIVE" ? "INACTIVE" : "ACTIVE";
      try {
        await apiRequest("PUT", `/api/employees/${employee.id}`, {
          status: newStatus,
        });
        queryClient.invalidateQueries({ queryKey: ["/api/employees"] });
      } catch {
        toast({
          title: "Error",
          description: isManager
            ? "Failed to update status."
            : "상태 변경에 실패했습니다",
          variant: "destructive",
        });
      }
    },
    [toast, isManager]
  );

  return (
    <AdminLayout title="Employee Management">
      <div className="space-y-6">
        <div>
          <h2 className="text-xl font-semibold">Employees</h2>
          <p className="text-sm text-muted-foreground">
            {isManager
              ? "View and manage employee details."
              : "직원 정보를 확인하고 관리합니다"}
          </p>
        </div>

        <div className="flex flex-col sm:flex-row gap-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by name or email..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10"
              data-testid="input-search-employees"
            />
          </div>
          <Select value={storeFilter} onValueChange={setStoreFilter}>
            <SelectTrigger className="w-full sm:w-[180px]" data-testid="select-store-filter">
              <SelectValue placeholder="Filter by store" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Stores</SelectItem>
              {stores
                ?.filter(s => s.active && (!isManager || /sushi|sandwich/i.test(s.name)))
                .map((store) => (
                  <SelectItem key={store.id} value={store.id}>
                    {store.name}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-full sm:w-[150px]" data-testid="select-status-filter">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Status</SelectItem>
              <SelectItem value="ACTIVE">Active</SelectItem>
              <SelectItem value="INACTIVE">Inactive</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <Card>
          <CardContent className="p-0">
            {employeesLoading ? (
              <div className="p-6 space-y-3">
                {[...Array(5)].map((_, i) => (
                  <Skeleton key={i} className="h-12 w-full" />
                ))}
              </div>
            ) : filteredEmployees?.length === 0 ? (
              <div className="p-12 text-center">
                <UserCheck className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
                <h3 className="text-lg font-medium mb-2">No employees found</h3>
                <p className="text-sm text-muted-foreground">
                  {employees?.length === 0
                    ? isManager
                      ? "Onboarded employees will appear here."
                      : "온보딩을 완료한 직원이 여기에 표시됩니다."
                    : isManager
                      ? "Try adjusting the search term or filter."
                      : "검색어 또는 필터 조건을 조정해 보세요."}
                </p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Nickname</TableHead>
                    <TableHead>Stores</TableHead>
                    <TableHead>Rate</TableHead>
                    <TableHead className="text-center">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredEmployees?.map((employee) => (
                    <TableRow
                      key={employee.id}
                      className="cursor-pointer"
                      onClick={() => handleRowClick(employee)}
                      data-testid={`row-employee-${employee.id}`}
                    >
                      <TableCell
                        className="font-medium"
                        title={`${employee.firstName} ${employee.lastName}`}
                        data-testid={`text-employee-name-${employee.id}`}
                      >
                        {employee.nickname || `${employee.firstName} ${employee.lastName}`}
                      </TableCell>
                      <TableCell data-testid={`text-store-${employee.id}`}>
                        <div className="flex flex-wrap gap-1">
                          {(empStoreMap.get(employee.id) ?? []).map(sid => {
                            const name = storeMap.get(sid)?.name ?? "Unknown";
                            const color = STORE_BRAND[name];
                            return (
                              <span
                                key={sid}
                                className="text-[10px] font-semibold px-2 py-0.5 rounded-full text-white"
                                style={{ backgroundColor: color ?? "#6366f1" }}
                              >
                                {name}
                              </span>
                            );
                          })}
                          {(empStoreMap.get(employee.id) ?? []).length === 0 && <span className="text-muted-foreground">—</span>}
                        </div>
                      </TableCell>
                      <TableCell data-testid={`text-rate-${employee.id}`}>
                        {employee.rate || "—"}
                      </TableCell>
                      <TableCell className="text-center">
                        <Badge
                          variant={employee.status === "ACTIVE" ? "default" : "secondary"}
                          className="cursor-pointer select-none text-xs"
                          onClick={(e) => toggleStatus(e, employee)}
                          data-testid={`badge-status-${employee.id}`}
                        >
                          {employee.status === "ACTIVE" ? "Active" : "Inactive"}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </AdminLayout>
  );
}
