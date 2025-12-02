import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useRoute } from "wouter";
import { AdminLayout } from "@/components/layouts/AdminLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ArrowLeft, Loader2, Save, User } from "lucide-react";
import { Link } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { Employee, Store, InsertEmployee } from "@shared/schema";

function FormSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-4">
      <h3 className="text-base font-semibold">{title}</h3>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {children}
      </div>
    </div>
  );
}

export function AdminEmployeeDetail() {
  const { toast } = useToast();
  const [, params] = useRoute("/admin/employees/:id");
  const employeeId = params?.id;

  const [formData, setFormData] = useState<Partial<InsertEmployee>>({});

  const { data: employee, isLoading: employeeLoading } = useQuery<Employee>({
    queryKey: ["/api/employees", employeeId],
    enabled: !!employeeId,
  });

  const { data: stores } = useQuery<Store[]>({
    queryKey: ["/api/stores"],
  });

  useEffect(() => {
    if (employee) {
      setFormData({});
    }
  }, [employee]);

  const updateMutation = useMutation({
    mutationFn: async (data: Partial<InsertEmployee>) => {
      const res = await apiRequest("PUT", `/api/employees/${employeeId}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/employees", employeeId] });
      queryClient.invalidateQueries({ queryKey: ["/api/employees"] });
      toast({ title: "Employee updated successfully" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const handleFieldChange = (field: keyof InsertEmployee, value: string | null) => {
    setFormData({ ...formData, [field]: value });
  };

  const handleSave = () => {
    if (Object.keys(formData).length > 0) {
      updateMutation.mutate(formData);
    }
  };

  if (employeeLoading) {
    return (
      <AdminLayout title="Employee Details">
        <div className="space-y-6">
          <Skeleton className="h-8 w-48" />
          <Card>
            <CardContent className="p-6 space-y-4">
              {[...Array(8)].map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </CardContent>
          </Card>
        </div>
      </AdminLayout>
    );
  }

  if (!employee) {
    return (
      <AdminLayout title="Employee Not Found">
        <Card>
          <CardContent className="p-12 text-center">
            <User className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
            <h3 className="text-lg font-medium mb-2">Employee not found</h3>
            <p className="text-sm text-muted-foreground mb-4">
              The employee you're looking for doesn't exist.
            </p>
            <Link href="/admin/employees">
              <Button>Back to Employees</Button>
            </Link>
          </CardContent>
        </Card>
      </AdminLayout>
    );
  }

  const currentData = { ...employee, ...formData };
  const hasChanges = Object.keys(formData).length > 0;

  return (
    <AdminLayout title="Employee Details">
      <div className="space-y-6">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <Link href="/admin/employees">
              <Button variant="ghost" size="icon" data-testid="button-back">
                <ArrowLeft className="w-4 h-4" />
              </Button>
            </Link>
            <div>
              <div className="flex items-center gap-3">
                <h2 className="text-xl font-semibold" data-testid="text-employee-name">
                  {employee.firstName} {employee.lastName}
                </h2>
                <Badge variant={employee.status === "ACTIVE" ? "default" : "secondary"}>
                  {employee.status}
                </Badge>
              </div>
              <p className="text-sm text-muted-foreground">
                {employee.nickname && `"${employee.nickname}" • `}
                {employee.email || "No email"}
              </p>
            </div>
          </div>
          <Button
            onClick={handleSave}
            disabled={!hasChanges || updateMutation.isPending}
            data-testid="button-save"
          >
            {updateMutation.isPending ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <Save className="w-4 h-4 mr-2" />
            )}
            Save Changes
          </Button>
        </div>

        <div className="grid gap-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Personal Information</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label>First Name</Label>
                  <Input value={employee.firstName} disabled className="bg-muted" />
                </div>
                <div className="space-y-2">
                  <Label>Last Name</Label>
                  <Input value={employee.lastName} disabled className="bg-muted" />
                </div>
                <div className="space-y-2">
                  <Label>Nickname</Label>
                  <Input value={employee.nickname ?? ""} disabled className="bg-muted" />
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label>Email</Label>
                  <Input value={employee.email ?? ""} disabled className="bg-muted" />
                </div>
                <div className="space-y-2">
                  <Label>Phone</Label>
                  <Input value={employee.phone ?? ""} disabled className="bg-muted" />
                </div>
                <div className="space-y-2">
                  <Label>Date of Birth</Label>
                  <Input value={employee.dob ?? ""} disabled className="bg-muted" />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Employment Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="storeId">Store</Label>
                  <Select
                    value={currentData.storeId ?? ""}
                    onValueChange={(value) => handleFieldChange("storeId", value || null)}
                  >
                    <SelectTrigger data-testid="select-store">
                      <SelectValue placeholder="Select store" />
                    </SelectTrigger>
                    <SelectContent>
                      {stores?.filter(s => s.active).map((store) => (
                        <SelectItem key={store.id} value={store.id}>
                          {store.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="status">Status</Label>
                  <Select
                    value={currentData.status ?? "ACTIVE"}
                    onValueChange={(value) => handleFieldChange("status", value)}
                  >
                    <SelectTrigger data-testid="select-status">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ACTIVE">Active</SelectItem>
                      <SelectItem value="INACTIVE">Inactive</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="rate">Rate</Label>
                  <Input
                    id="rate"
                    value={currentData.rate ?? ""}
                    onChange={(e) => handleFieldChange("rate", e.target.value)}
                    placeholder="e.g., $25/hr"
                    data-testid="input-rate"
                  />
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="fixedAmount">Fixed Amount</Label>
                  <Input
                    id="fixedAmount"
                    value={currentData.fixedAmount ?? ""}
                    onChange={(e) => handleFieldChange("fixedAmount", e.target.value)}
                    placeholder="Enter amount"
                    data-testid="input-fixed-amount"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="salaryType">Salary Type</Label>
                  <Select
                    value={currentData.salaryType ?? ""}
                    onValueChange={(value) => handleFieldChange("salaryType", value)}
                  >
                    <SelectTrigger data-testid="select-salary-type">
                      <SelectValue placeholder="Select type" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="hourly">Hourly</SelectItem>
                      <SelectItem value="salary">Salary</SelectItem>
                      <SelectItem value="casual">Casual</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="annualLeave">Annual Leave</Label>
                  <Input
                    id="annualLeave"
                    value={currentData.annualLeave ?? ""}
                    onChange={(e) => handleFieldChange("annualLeave", e.target.value)}
                    placeholder="e.g., 20 days"
                    data-testid="input-annual-leave"
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Banking Information</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="tfn">TFN</Label>
                  <Input
                    id="tfn"
                    value={currentData.tfn ?? ""}
                    onChange={(e) => handleFieldChange("tfn", e.target.value)}
                    placeholder="Tax File Number"
                    data-testid="input-tfn"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="bsb">BSB</Label>
                  <Input
                    id="bsb"
                    value={currentData.bsb ?? ""}
                    onChange={(e) => handleFieldChange("bsb", e.target.value)}
                    placeholder="BSB Number"
                    data-testid="input-bsb"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="accountNo">Account Number</Label>
                  <Input
                    id="accountNo"
                    value={currentData.accountNo ?? ""}
                    onChange={(e) => handleFieldChange("accountNo", e.target.value)}
                    placeholder="Account Number"
                    data-testid="input-account-no"
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Superannuation</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="superCompany">Super Company</Label>
                  <Input
                    id="superCompany"
                    value={currentData.superCompany ?? ""}
                    onChange={(e) => handleFieldChange("superCompany", e.target.value)}
                    placeholder="Superannuation Company"
                    data-testid="input-super-company"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="superMembershipNo">Membership Number</Label>
                  <Input
                    id="superMembershipNo"
                    value={currentData.superMembershipNo ?? ""}
                    onChange={(e) => handleFieldChange("superMembershipNo", e.target.value)}
                    placeholder="Membership Number"
                    data-testid="input-super-membership"
                  />
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </AdminLayout>
  );
}
