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
import { UserCheck, Search, Link2, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLocation } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { Employee, Store, EmployeeStoreAssignment } from "@shared/schema";

export function AdminEmployees() {
  const [, setLocation] = useLocation();
  const [linkCopied, setLinkCopied] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [storeFilter, setStoreFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
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
  });

  const handleRowClick = (employee: Employee) => {
    setLocation(`/admin/employees/${employee.id}`);
  };

  const formatDate = (dateString: string | null) => {
    if (!dateString) return "—";
    return new Date(dateString).toLocaleDateString();
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
          description: "상태 변경에 실패했습니다",
          variant: "destructive",
        });
      }
    },
    [toast]
  );

  return (
    <AdminLayout title="Employee Management">
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <h2 className="text-xl font-semibold">Employees</h2>
            <p className="text-sm text-muted-foreground">
              직원 정보를 확인하고 관리합니다
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            data-testid="button-copy-register-link"
            onClick={() => {
              const url = `${window.location.origin}/m/register`;
              navigator.clipboard.writeText(url);
              setLinkCopied(true);
              toast({ title: "Link Copied", description: "신규 직원 등록 링크가 복사되었습니다" });
              setTimeout(() => setLinkCopied(false), 2000);
            }}
          >
            {linkCopied ? <Check className="h-4 w-4 mr-1.5" /> : <Link2 className="h-4 w-4 mr-1.5" />}
            {linkCopied ? "Copied!" : "Copy Registration Link"}
          </Button>
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
              {stores?.filter(s => s.active).map((store) => (
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
                    ? "온보딩을 완료한 직원이 여기에 표시됩니다."
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
                    <TableHead>Visa Expiry</TableHead>
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
                        {getStoreNames(employee.id)}
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
                      <TableCell className="text-muted-foreground" data-testid={`text-visa-${employee.id}`}>
                        {formatDate(employee.visaExpiry)}
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
