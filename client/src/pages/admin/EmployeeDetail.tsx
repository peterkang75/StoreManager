import { useState, useEffect, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useRoute } from "wouter";
import { AdminLayout } from "@/components/layouts/AdminLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ArrowLeft, Loader2, Save, User, ExternalLink, Camera, FileImage } from "lucide-react";
import { Link } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { Employee, Store, InsertEmployee, EmployeeStoreAssignment } from "@shared/schema";

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
  const [selectedStoreIds, setSelectedStoreIds] = useState<string[]>([]);
  const [storesDirty, setStoresDirty] = useState(false);
  const [assignmentOverrides, setAssignmentOverrides] = useState<Record<string, { rate?: string; fixedAmount?: string }>>({});

  const { data: employee, isLoading: employeeLoading } = useQuery<Employee>({
    queryKey: ["/api/employees", employeeId],
    enabled: !!employeeId,
  });

  const { data: stores } = useQuery<Store[]>({
    queryKey: ["/api/stores"],
  });

  const { data: storeAssignments } = useQuery<EmployeeStoreAssignment[]>({
    queryKey: ["/api/employee-store-assignments", employeeId],
    queryFn: async () => {
      const res = await fetch(`/api/employee-store-assignments?employee_id=${employeeId}`);
      if (!res.ok) throw new Error("Failed to fetch assignments");
      return res.json();
    },
    enabled: !!employeeId,
  });

  useEffect(() => {
    if (employee) {
      setFormData({});
    }
  }, [employee]);

  useEffect(() => {
    if (storeAssignments) {
      setSelectedStoreIds(storeAssignments.map(a => a.storeId));
      setStoresDirty(false);
      const overrides: Record<string, { rate?: string; fixedAmount?: string }> = {};
      for (const a of storeAssignments) {
        overrides[a.id] = { rate: a.rate || "", fixedAmount: a.fixedAmount || "" };
      }
      setAssignmentOverrides(overrides);
    }
  }, [storeAssignments]);

  const updateMutation = useMutation({
    mutationFn: async (data: Partial<InsertEmployee>) => {
      const res = await apiRequest("PUT", `/api/employees/${employeeId}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/employees", employeeId] });
      queryClient.invalidateQueries({ queryKey: ["/api/employees"] });
      queryClient.invalidateQueries({ queryKey: ["/api/payrolls/current"] });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const storeAssignmentMutation = useMutation({
    mutationFn: async (storeIds: string[]) => {
      const res = await apiRequest("PUT", `/api/employees/${employeeId}/store-assignments`, { storeIds });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/employee-store-assignments", employeeId] });
      queryClient.invalidateQueries({ queryKey: ["/api/employee-store-assignments"] });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const handleFieldChange = (field: keyof InsertEmployee, value: string | null) => {
    setFormData({ ...formData, [field]: value });
  };

  const handleStoreToggle = useCallback((storeId: string, checked: boolean) => {
    setSelectedStoreIds(prev => {
      if (checked) return [...prev, storeId];
      return prev.filter(id => id !== storeId);
    });
    setStoresDirty(true);
  }, []);

  const handleSave = async () => {
    const promises: Promise<any>[] = [];
    if (Object.keys(formData).length > 0) {
      promises.push(updateMutation.mutateAsync(formData));
    }
    if (storesDirty) {
      promises.push(storeAssignmentMutation.mutateAsync(selectedStoreIds));
    }
    if (storeAssignments && storeAssignments.length > 1) {
      for (const a of storeAssignments) {
        const override = assignmentOverrides[a.id];
        if (override && (override.rate !== (a.rate || "") || override.fixedAmount !== (a.fixedAmount || ""))) {
          promises.push(
            apiRequest("PATCH", `/api/employee-store-assignments/${a.id}`, {
              rate: override.rate || null,
              fixedAmount: override.fixedAmount || null,
            })
          );
        }
      }
    }
    if (promises.length > 0) {
      await Promise.all(promises);
      queryClient.invalidateQueries({ queryKey: ["/api/employee-store-assignments", employeeId] });
      queryClient.invalidateQueries({ queryKey: ["/api/payrolls/current"] });
      toast({ title: "Employee updated successfully" });
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
              찾고 있는 직원이 존재하지 않습니다.
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
  const hasChanges = Object.keys(formData).length > 0 || storesDirty;
  const isSaving = updateMutation.isPending || storeAssignmentMutation.isPending;

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
            {/* Avatar */}
            {currentData.selfieUrl ? (
              <img
                src={currentData.selfieUrl}
                alt={employee.firstName}
                className="h-12 w-12 rounded-full object-cover shrink-0 border border-border/40"
              />
            ) : (
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted shrink-0">
                <User className="w-6 h-6 text-muted-foreground" />
              </div>
            )}
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
            disabled={!hasChanges || isSaving}
            data-testid="button-save"
          >
            {isSaving ? (
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

          {/* Photos & Documents */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Photos & Documents</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Selfie */}
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <Camera className="h-4 w-4 text-muted-foreground" />
                  <Label className="font-medium">Selfie / Profile Photo</Label>
                </div>
                <div className="flex items-start gap-4">
                  {currentData.selfieUrl ? (
                    <img
                      src={currentData.selfieUrl}
                      alt="Selfie"
                      className="h-24 w-24 rounded-xl object-cover border border-border/40 shrink-0"
                      onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                    />
                  ) : (
                    <div className="flex h-24 w-24 items-center justify-center rounded-xl bg-muted border border-border/40 shrink-0">
                      <User className="h-8 w-8 text-muted-foreground" />
                    </div>
                  )}
                  <div className="flex-1 space-y-1.5">
                    <Input
                      value={currentData.selfieUrl ?? ""}
                      onChange={(e) => handleFieldChange("selfieUrl", e.target.value || null)}
                      placeholder="https://..."
                      className="font-mono text-xs"
                      data-testid="input-selfie-url"
                    />
                    <p className="text-xs text-muted-foreground">URL of employee selfie/profile photo</p>
                  </div>
                </div>
              </div>

              {/* Passport */}
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <FileImage className="h-4 w-4 text-muted-foreground" />
                  <Label className="font-medium">Passport Photo</Label>
                </div>
                <div className="flex items-start gap-4">
                  {currentData.passportUrl ? (
                    <img
                      src={currentData.passportUrl}
                      alt="Passport"
                      className="h-24 w-24 rounded-xl object-cover border border-border/40 shrink-0"
                      onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                    />
                  ) : (
                    <div className="flex h-24 w-24 items-center justify-center rounded-xl bg-muted border border-border/40 shrink-0">
                      <FileImage className="h-8 w-8 text-muted-foreground" />
                    </div>
                  )}
                  <div className="flex-1 space-y-1.5">
                    <Input
                      value={currentData.passportUrl ?? ""}
                      onChange={(e) => handleFieldChange("passportUrl", e.target.value || null)}
                      placeholder="https://..."
                      className="font-mono text-xs"
                      data-testid="input-passport-url"
                    />
                    <p className="text-xs text-muted-foreground">URL of passport photo or scan</p>
                  </div>
                </div>
              </div>

              {/* FHC Document */}
              {currentData.fhc && (
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <ExternalLink className="h-4 w-4 text-muted-foreground" />
                    <Label className="font-medium">FHC Document</Label>
                  </div>
                  <div className="flex items-start gap-4">
                    {/\.(jpg|jpeg|png|gif|webp)$/i.test(currentData.fhc) ? (
                      <img
                        src={currentData.fhc}
                        alt="FHC"
                        className="h-24 w-auto max-w-[160px] rounded-xl object-cover border border-border/40 shrink-0"
                        onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                      />
                    ) : (
                      <div className="flex h-24 w-24 items-center justify-center rounded-xl bg-muted border border-border/40 shrink-0">
                        <FileImage className="h-8 w-8 text-muted-foreground" />
                      </div>
                    )}
                    <div className="flex-1 space-y-1.5">
                      <a
                        href={currentData.fhc}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline break-all"
                      >
                        <ExternalLink className="h-3.5 w-3.5 shrink-0" />
                        Open document
                      </a>
                      <p className="text-xs text-muted-foreground font-mono break-all">{currentData.fhc}</p>
                    </div>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Employment Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Stores</Label>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3" data-testid="checkbox-group-stores">
                  {stores?.filter(s => s.active).map((store) => (
                    <label
                      key={store.id}
                      className="flex items-center gap-2 cursor-pointer"
                      data-testid={`checkbox-store-${store.id}`}
                    >
                      <Checkbox
                        checked={selectedStoreIds.includes(store.id)}
                        onCheckedChange={(checked) => handleStoreToggle(store.id, !!checked)}
                      />
                      <span className="text-sm">{store.name}</span>
                    </label>
                  ))}
                </div>
                {storeAssignments && storeAssignments.length > 1 && (
                  <div className="mt-3 space-y-2">
                    <Label className="text-xs text-muted-foreground">매장별 Rate / Fixed Amount 설정</Label>
                    <div className="space-y-2">
                      {storeAssignments.map((a) => {
                        const store = stores?.find((s) => s.id === a.storeId);
                        if (!store) return null;
                        const override = assignmentOverrides[a.id] || { rate: "", fixedAmount: "" };
                        return (
                          <div key={a.id} className="flex items-center gap-3">
                            <span className="text-sm font-medium w-24 shrink-0" data-testid={`text-assign-store-${store.name}`}>{store.name}</span>
                            <div className="flex items-center gap-1">
                              <Label className="text-xs text-muted-foreground shrink-0">Rate</Label>
                              <Input
                                className="w-24"
                                placeholder="–"
                                value={override.rate}
                                onChange={(e) => setAssignmentOverrides((prev) => ({
                                  ...prev,
                                  [a.id]: { ...prev[a.id], rate: e.target.value },
                                }))}
                                data-testid={`input-assign-rate-${store.name.toLowerCase()}`}
                              />
                            </div>
                            <div className="flex items-center gap-1">
                              <Label className="text-xs text-muted-foreground shrink-0">Fixed</Label>
                              <Input
                                className="w-24"
                                placeholder="–"
                                value={override.fixedAmount}
                                onChange={(e) => setAssignmentOverrides((prev) => ({
                                  ...prev,
                                  [a.id]: { ...prev[a.id], fixedAmount: e.target.value },
                                }))}
                                data-testid={`input-assign-fixed-${store.name.toLowerCase()}`}
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
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
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
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
              <CardTitle className="text-base">Portal Access</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="role">Role</Label>
                  <Select
                    value={currentData.role ?? "EMPLOYEE"}
                    onValueChange={(value) => handleFieldChange("role", value)}
                  >
                    <SelectTrigger data-testid="select-role">
                      <SelectValue placeholder="Select role" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="OWNER">Owner</SelectItem>
                      <SelectItem value="MANAGER">Manager</SelectItem>
                      <SelectItem value="EMPLOYEE">Employee</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="pin">4-Digit PIN</Label>
                  <Input
                    id="pin"
                    value={currentData.pin ?? ""}
                    onChange={(e) => {
                      const val = e.target.value.replace(/\D/g, "").slice(0, 4);
                      handleFieldChange("pin", val || null);
                    }}
                    placeholder="e.g., 1234"
                    maxLength={4}
                    inputMode="numeric"
                    data-testid="input-pin"
                  />
                  <p className="text-xs text-muted-foreground">모바일 앱 접속용 4자리 숫자 PIN</p>
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
