import { useState, useEffect, useCallback, useRef } from "react";
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
import { ArrowLeft, Loader2, Save, User, ExternalLink, Camera, FileImage, Upload, X, ShieldCheck, AlertTriangle, ClipboardCopy, CheckCircle2, Shield, FileText, Download, Lock } from "lucide-react";
import { Link } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { Employee, Store, InsertEmployee, EmployeeStoreAssignment } from "@shared/schema";

function FhcUploadSection({ value, onChange }: { value: string | null; onChange: (url: string | null) => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const { toast } = useToast();

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/upload", { method: "POST", body: fd });
      if (!res.ok) throw new Error("Upload failed");
      const data = await res.json();
      onChange(data.url);
    } catch {
      toast({ title: "Upload failed", description: "Could not upload the file.", variant: "destructive" });
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const isImage = value && /\.(jpg|jpeg|png|gif|webp)$/i.test(value);
  const isPdf = value && /\.pdf$/i.test(value);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <FileImage className="h-4 w-4 text-muted-foreground" />
        <Label className="font-medium">FHC (Food Handler Certificate)</Label>
      </div>
      <div className="flex items-start gap-4">
        {/* Preview */}
        {isImage ? (
          <img
            src={value!}
            alt="FHC"
            className="h-24 w-auto max-w-[160px] rounded-xl object-cover border border-border/40 shrink-0"
            onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
          />
        ) : (
          <div className="flex h-24 w-24 items-center justify-center rounded-xl bg-muted border border-border/40 shrink-0">
            <FileImage className={`h-8 w-8 ${value ? "text-primary" : "text-muted-foreground"}`} />
          </div>
        )}
        <div className="flex-1 space-y-2">
          {value && (
            <div className="flex items-center gap-2 flex-wrap">
              <a
                href={value}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
              >
                <ExternalLink className="h-3.5 w-3.5 shrink-0" />
                {isPdf ? "Open PDF" : "Open file"}
              </a>
              <button
                type="button"
                onClick={() => onChange(null)}
                className="inline-flex items-center gap-1 text-xs text-destructive hover:underline"
              >
                <X className="h-3 w-3" />
                Remove
              </button>
            </div>
          )}
          <p className="text-xs text-muted-foreground font-mono break-all truncate max-w-xs">{value || "No file uploaded"}</p>
          <input ref={fileRef} type="file" accept=".jpg,.jpeg,.png,.webp,.pdf" className="hidden" onChange={handleFile} />
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            data-testid="button-upload-fhc"
          >
            {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <Upload className="h-3.5 w-3.5 mr-1.5" />}
            {uploading ? "Uploading..." : value ? "Replace file" : "Upload file"}
          </Button>
          <p className="text-xs text-muted-foreground">JPEG, PNG, WebP or PDF · max 10 MB</p>
        </div>
      </div>
    </div>
  );
}

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
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const [vevoUploading, setVevoUploading] = useState(false);
  const [vevoVerifiedByInput, setVevoVerifiedByInput] = useState("");
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [showVevoModal, setShowVevoModal] = useState(false);
  const [vevoFileName, setVevoFileName] = useState<string | null>(null);
  const vevoFileRef = useRef<HTMLInputElement>(null);

  const { data: employee, isLoading: employeeLoading } = useQuery<Employee>({
    queryKey: ["/api/employees", employeeId],
    enabled: !!employeeId,
    staleTime: 0,
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

  const getVisaStatus = (visaExpiry: string | null | undefined): "urgent" | "expiring_soon" | "valid" | "no_data" => {
    if (!visaExpiry) return "no_data";
    const expiry = new Date(visaExpiry);
    if (isNaN(expiry.getTime())) return "no_data";
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const daysLeft = Math.ceil((expiry.getTime() - today.getTime()) / 86400000);
    if (daysLeft <= 14) return "urgent";   // expired or within 14 days → RED
    if (daysLeft <= 60) return "expiring_soon"; // within 60 days → AMBER
    return "valid";
  };

  // Returns true when a VEVO file is present AND this specific field was populated from it
  const isVevoLocked = (vevoUrl: string | null | undefined, value: string | null | undefined) => !!vevoUrl && !!value;

  const copyToClipboard = async (text: string, field: string) => {
    if (!text) return;
    await navigator.clipboard.writeText(text);
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 2000);
  };

  const todayYMD = () => new Date().toLocaleDateString("en-CA", { timeZone: "Australia/Sydney" });

  const handleVevoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setVevoUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(`/api/employees/${employeeId}/vevo-upload`, { method: "POST", body: fd });
      if (!res.ok) throw new Error("Upload failed");
      const data = await res.json();
      const parsed: Record<string, string | null> = data.parsedData ?? {};
      const today = todayYMD();

      // Build the fields to save immediately to DB
      const patch: Record<string, string | null> = {
        vevoUrl: data.url,
        lastVevoCheckDate: today,
      };
      if (parsed.visaExpiry) patch.visaExpiry = parsed.visaExpiry;
      if (parsed.visaSubclass) patch.visaSubclass = parsed.visaSubclass;
      if (parsed.workEntitlements) patch.workEntitlements = parsed.workEntitlements;
      if (parsed.passportNo) patch.passportNo = parsed.passportNo;
      if (parsed.nationality) patch.nationality = parsed.nationality;

      // Persist immediately — no need to click Save
      await apiRequest("PUT", `/api/employees/${employeeId}`, patch);
      queryClient.invalidateQueries({ queryKey: ["/api/employees", employeeId] });

      setVevoFileName(data.originalName || file.name);
      setFormData(prev => ({ ...prev, ...patch }));

      const parsedCount = Object.values(parsed).filter(Boolean).length;
      const parsedFields = [
        parsed.visaExpiry && `Expiry: ${parsed.visaExpiry}`,
        parsed.visaSubclass && `Subclass: ${parsed.visaSubclass}`,
        parsed.workEntitlements && `Work: ${parsed.workEntitlements}`,
      ].filter(Boolean).join(" · ");
      if (parsedCount === 0) {
        toast({
          title: "VEVO document saved",
          description: "파일이 이미지 기반 PDF라 텍스트를 자동으로 읽을 수 없습니다. 아래 입력창에 직접 입력 후 Save 해주세요.",
          variant: "default",
        });
      } else {
        toast({
          title: "VEVO document saved",
          description: parsedFields,
        });
      }
    } catch {
      toast({ title: "Upload failed", variant: "destructive" });
    } finally {
      setVevoUploading(false);
      if (vevoFileRef.current) vevoFileRef.current.value = "";
    }
  };

  const handleMarkVerified = async () => {
    const name = vevoVerifiedByInput.trim();
    if (!name) { toast({ title: "Enter your name first", variant: "destructive" }); return; }
    const now = new Date().toISOString();
    await updateMutation.mutateAsync({ vevoVerifiedAt: now, vevoVerifiedBy: name });
    setVevoVerifiedByInput("");
    toast({ title: "Verification recorded", description: `Logged by ${name}` });
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
                className="h-12 w-12 rounded-full object-cover shrink-0 border border-border/40 cursor-zoom-in"
                onClick={() => setLightboxUrl(currentData.selfieUrl!)}
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
                  <Input value={currentData.firstName ?? ""} onChange={(e) => handleFieldChange("firstName", e.target.value)} data-testid="input-first-name" />
                </div>
                <div className="space-y-2">
                  <Label>Last Name</Label>
                  <Input value={currentData.lastName ?? ""} onChange={(e) => handleFieldChange("lastName", e.target.value)} data-testid="input-last-name" />
                </div>
                <div className="space-y-2">
                  <Label>Nickname</Label>
                  <Input value={currentData.nickname ?? ""} onChange={(e) => handleFieldChange("nickname", e.target.value || null)} placeholder="Nickname" data-testid="input-nickname" />
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label>Email</Label>
                  <Input value={currentData.email ?? ""} onChange={(e) => handleFieldChange("email", e.target.value || null)} placeholder="Email" data-testid="input-email" />
                </div>
                <div className="space-y-2">
                  <Label>Phone</Label>
                  <Input value={currentData.phone ?? ""} onChange={(e) => handleFieldChange("phone", e.target.value || null)} placeholder="Phone" data-testid="input-phone" />
                </div>
                <div className="space-y-2">
                  <Label>Date of Birth</Label>
                  <Input value={currentData.dob ?? ""} onChange={(e) => handleFieldChange("dob", e.target.value || null)} placeholder="DD-MM-YYYY" data-testid="input-dob" />
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label>Gender</Label>
                  <Input value={currentData.gender ?? ""} onChange={(e) => handleFieldChange("gender", e.target.value || null)} placeholder="Gender" data-testid="input-gender" />
                </div>
                <div className="space-y-2">
                  <Label>Marital Status</Label>
                  <Input value={currentData.maritalStatus ?? ""} onChange={(e) => handleFieldChange("maritalStatus", e.target.value || null)} placeholder="Marital Status" data-testid="input-marital-status" />
                </div>
                <div className="space-y-2">
                  <Label>Line ID</Label>
                  <Input value={currentData.lineId ?? ""} onChange={(e) => handleFieldChange("lineId", e.target.value || null)} placeholder="Line ID" data-testid="input-line-id" />
                </div>
              </div>
              {/* Address */}
              <div className="pt-1 border-t border-border/40">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-3">Address</p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Street Address</Label>
                    <Input value={currentData.streetAddress ?? ""} onChange={(e) => handleFieldChange("streetAddress", e.target.value || null)} placeholder="Street Address" data-testid="input-street-address" />
                  </div>
                  <div className="space-y-2">
                    <Label>Street Address 2</Label>
                    <Input value={currentData.streetAddress2 ?? ""} onChange={(e) => handleFieldChange("streetAddress2", e.target.value || null)} placeholder="Apt, unit, etc." data-testid="input-street-address-2" />
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4">
                  <div className="space-y-2">
                    <Label>Suburb</Label>
                    <Input value={currentData.suburb ?? ""} onChange={(e) => handleFieldChange("suburb", e.target.value || null)} placeholder="Suburb" data-testid="input-suburb" />
                  </div>
                  <div className="space-y-2">
                    <Label>State</Label>
                    <Input value={currentData.state ?? ""} onChange={(e) => handleFieldChange("state", e.target.value || null)} placeholder="NSW" data-testid="input-state" />
                  </div>
                  <div className="space-y-2">
                    <Label>Post Code</Label>
                    <Input value={currentData.postCode ?? ""} onChange={(e) => handleFieldChange("postCode", e.target.value || null)} placeholder="2000" data-testid="input-post-code" />
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Visa & Compliance */}
          {(() => {
            const visaStatus = getVisaStatus(currentData.visaExpiry);
            const daysLeft = currentData.visaExpiry ? Math.ceil((new Date(currentData.visaExpiry).getTime() - Date.now()) / 86400000) : null;
            return (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <ShieldCheck className="h-4 w-4" />
                    Visa &amp; Compliance
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-5">

                  {/* Visa Status Alerts */}
                  {visaStatus === "urgent" && (
                    <div className="flex items-start gap-3 rounded-md border border-destructive/60 bg-destructive/10 p-3" data-testid="alert-visa-urgent">
                      <AlertTriangle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
                      <div>
                        <p className="text-sm font-bold text-destructive">
                          {daysLeft !== null && daysLeft <= 0
                            ? "⚠️ URGENT: VISA EXPIRED — WORK PROHIBITED"
                            : `⚠️ URGENT: VISA EXPIRES IN ${daysLeft} DAY${daysLeft === 1 ? "" : "S"} — ACTION REQUIRED`}
                        </p>
                        <p className="text-xs text-destructive/80 mt-0.5">
                          {daysLeft !== null && daysLeft <= 0
                            ? `Expired on ${currentData.visaExpiry}. This employee cannot legally work in Australia.`
                            : `Expiry: ${currentData.visaExpiry}. Verify work rights immediately.`}
                        </p>
                      </div>
                    </div>
                  )}
                  {visaStatus === "expiring_soon" && (
                    <div className="flex items-start gap-3 rounded-md border border-orange-400/60 bg-orange-400/10 p-3" data-testid="alert-visa-expiring">
                      <AlertTriangle className="h-5 w-5 text-orange-500 shrink-0 mt-0.5" />
                      <div>
                        <p className="text-sm font-semibold text-orange-600 dark:text-orange-400">Visa Expiring Soon — {daysLeft} day{daysLeft === 1 ? "" : "s"} remaining</p>
                        <p className="text-xs text-orange-500/80 mt-0.5">Expires {currentData.visaExpiry}. Schedule a VEVO check and renewal.</p>
                      </div>
                    </div>
                  )}
                  {visaStatus === "valid" && currentData.visaExpiry && currentData.vevoUrl && (
                    <div className="flex items-center gap-3 rounded-md border border-green-500/30 bg-green-500/8 p-3" data-testid="alert-visa-valid">
                      <CheckCircle2 className="h-5 w-5 text-green-600 shrink-0" />
                      <div>
                        <p className="text-sm text-green-700 dark:text-green-400">Work rights valid — visa expires {currentData.visaExpiry} ({daysLeft} days remaining)</p>
                        {currentData.workEntitlements === "Restricted" && (
                          <p className="text-xs text-green-600/80 dark:text-green-500/80 mt-0.5">Work allowed 48 hrs / fortnight (while course in session)</p>
                        )}
                      </div>
                    </div>
                  )}
                  {visaStatus === "valid" && currentData.visaExpiry && !currentData.vevoUrl && (
                    <div className="flex items-center gap-3 rounded-md border border-border/40 bg-muted/30 p-3" data-testid="alert-visa-no-vevo">
                      <AlertTriangle className="h-5 w-5 text-muted-foreground shrink-0" />
                      <p className="text-sm text-muted-foreground">Visa expiry on record — upload VEVO result to confirm work rights</p>
                    </div>
                  )}
                  {currentData.workEntitlements === "No Work Rights" && (
                    <div className="flex items-start gap-3 rounded-md border border-destructive/60 bg-destructive/10 p-3" data-testid="alert-no-work-rights">
                      <AlertTriangle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
                      <div>
                        <p className="text-sm font-semibold text-destructive">No Work Rights — This employee is NOT permitted to work</p>
                        <p className="text-xs text-destructive/80 mt-0.5">Confirmed via VEVO. Do not roster or pay this employee for any work.</p>
                      </div>
                    </div>
                  )}

                  {/* Visa Fields */}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="space-y-2">
                      <Label>Visa Type</Label>
                      <Input value={currentData.visaType ?? ""} onChange={(e) => handleFieldChange("visaType", e.target.value || null)} placeholder="e.g. Student, WHM, PR" data-testid="input-visa-type" />
                    </div>
                    <div className="space-y-2">
                      <Label className="flex items-center gap-1">
                        Visa Subclass
                        {isVevoLocked(currentData.vevoUrl, currentData.visaSubclass) && <Lock className="h-3 w-3 text-muted-foreground" />}
                      </Label>
                      <Input value={currentData.visaSubclass ?? ""} onChange={(e) => handleFieldChange("visaSubclass", e.target.value || null)} placeholder="e.g. 500, 417, 485" data-testid="input-visa-subclass" disabled={isVevoLocked(currentData.vevoUrl, currentData.visaSubclass)} />
                    </div>
                    <div className="space-y-2">
                      <Label className="flex items-center gap-1">
                        Visa Expiry Date
                        {isVevoLocked(currentData.vevoUrl, currentData.visaExpiry) && <Lock className="h-3 w-3 text-muted-foreground" />}
                      </Label>
                      <Input type="date" value={currentData.visaExpiry ?? ""} onChange={(e) => handleFieldChange("visaExpiry", e.target.value || null)} data-testid="input-visa-expiry" disabled={isVevoLocked(currentData.vevoUrl, currentData.visaExpiry)} />
                    </div>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="space-y-2">
                      <Label className="flex items-center gap-1">
                        Work Entitlements
                        {isVevoLocked(currentData.vevoUrl, currentData.workEntitlements) && <Lock className="h-3 w-3 text-muted-foreground" />}
                      </Label>
                      <Select value={currentData.workEntitlements ?? ""} onValueChange={(v) => handleFieldChange("workEntitlements", v || null)} disabled={isVevoLocked(currentData.vevoUrl, currentData.workEntitlements)}>
                        <SelectTrigger data-testid="select-work-entitlements">
                          <SelectValue placeholder="Select..." />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="Full Work Rights">Full Work Rights</SelectItem>
                          <SelectItem value="Restricted">Restricted</SelectItem>
                          <SelectItem value="No Work Rights">No Work Rights</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label className="flex items-center gap-1">
                        Passport No
                        {isVevoLocked(currentData.vevoUrl, currentData.passportNo) && <Lock className="h-3 w-3 text-muted-foreground" />}
                      </Label>
                      <Input value={currentData.passportNo ?? ""} onChange={(e) => handleFieldChange("passportNo", e.target.value || null)} placeholder="Passport number" data-testid="input-passport-no" disabled={isVevoLocked(currentData.vevoUrl, currentData.passportNo)} />
                    </div>
                    <div className="space-y-2">
                      <Label className="flex items-center gap-1">
                        Country of Passport
                        {isVevoLocked(currentData.vevoUrl, currentData.nationality) && <Lock className="h-3 w-3 text-muted-foreground" />}
                      </Label>
                      <Input value={currentData.nationality ?? ""} onChange={(e) => handleFieldChange("nationality", e.target.value || null)} placeholder="e.g. Nepal, India" data-testid="input-nationality" disabled={isVevoLocked(currentData.vevoUrl, currentData.nationality)} />
                    </div>
                  </div>
                  {currentData.vevoUrl && (
                    <p className="text-xs text-muted-foreground">
                      <Lock className="inline h-3 w-3 mr-1" />
                      Fields filled from VEVO document are locked. Remove the document to edit them manually.
                    </p>
                  )}

                  {/* VEVO Helper */}
                  <div className="rounded-md border border-border/40 bg-muted/30 p-4 space-y-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <p className="text-sm font-medium">VEVO Organisation Login</p>
                        <p className="text-xs text-muted-foreground">Copy employee details, then open the government portal</p>
                      </div>
                      <Button size="sm" onClick={() => { setShowVevoModal(true); setFormData(prev => ({ ...prev, lastVevoCheckDate: todayYMD() })); }} data-testid="button-open-vevo-modal">
                        <ExternalLink className="h-3.5 w-3.5 mr-1.5" />
                        Open VEVO Organisation Login
                      </Button>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <div className="space-y-2">
                        <Label>Last VEVO Check Date</Label>
                        <Input type="date" value={currentData.lastVevoCheckDate ?? ""} onChange={(e) => handleFieldChange("lastVevoCheckDate", e.target.value || null)} data-testid="input-last-vevo-check" />
                      </div>
                    </div>
                  </div>

                  {/* VEVO Document Upload */}
                  <div className="space-y-2">
                    <div>
                      <Label className="font-medium">VEVO Result Document (PDF / Image)</Label>
                      <p className="text-xs text-muted-foreground mt-0.5">텍스트 PDF는 자동 입력됩니다. 이미지/스캔 PDF는 자동 입력이 안 되며, 업로드 후 아래 항목을 직접 입력하세요.</p>
                    </div>
                    <div className="flex items-center gap-3">
                      <input ref={vevoFileRef} type="file" accept=".pdf,image/*" className="hidden" onChange={handleVevoUpload} data-testid="input-vevo-file" />
                      {currentData.vevoUrl ? (
                        <div className="flex flex-1 flex-wrap items-center gap-2 rounded-md border border-border/40 bg-muted/30 px-3 py-2">
                          <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
                          <span className="flex-1 truncate text-sm font-medium min-w-0" data-testid="text-vevo-filename">
                            {vevoFileName || currentData.vevoUrl.split("/").pop()?.replace(/^\d+-\d+-/, "") || "VEVO Document"}
                          </span>
                          <div className="flex items-center gap-1 shrink-0">
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 px-2 text-xs"
                              onClick={() => window.open(currentData.vevoUrl!, "_blank")}
                              data-testid="button-view-vevo"
                            >
                              <Download className="h-3.5 w-3.5 mr-1" />
                              View
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 px-2 text-xs"
                              onClick={() => vevoFileRef.current?.click()}
                              disabled={vevoUploading}
                              data-testid="button-replace-vevo"
                            >
                              <Upload className="h-3.5 w-3.5 mr-1" />
                              Replace
                            </Button>
                            <Button size="icon" variant="ghost" className="h-7 w-7 shrink-0" onClick={async () => { handleFieldChange("vevoUrl", null); setVevoFileName(null); await apiRequest("PUT", `/api/employees/${employeeId}`, { vevoUrl: null }); queryClient.invalidateQueries({ queryKey: ["/api/employees", employeeId] }); }} data-testid="button-remove-vevo">
                              <X className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <Button size="sm" variant="outline" onClick={() => vevoFileRef.current?.click()} disabled={vevoUploading} data-testid="button-upload-vevo">
                          {vevoUploading ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Upload className="h-3.5 w-3.5 mr-1.5" />}
                          {vevoUploading ? "Uploading..." : "Upload VEVO Result"}
                        </Button>
                      )}
                    </div>
                  </div>

                  {/* Verification Log */}
                  <div className="space-y-3 border-t border-border/40 pt-4">
                    <p className="text-sm font-medium">Verification Audit Log</p>
                    {currentData.vevoVerifiedAt && (
                      <div className="flex items-center gap-2 rounded-md border border-green-500/30 bg-green-500/8 px-3 py-2" data-testid="vevo-last-verified">
                        <CheckCircle2 className="h-4 w-4 text-green-600 shrink-0" />
                        <p className="text-sm">
                          Last verified on <span className="font-medium">{new Date(currentData.vevoVerifiedAt).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" })}</span>
                          {" "}by <span className="font-medium">{currentData.vevoVerifiedBy}</span>
                        </p>
                      </div>
                    )}
                    <div className="flex flex-wrap items-center gap-2">
                      <Input
                        value={vevoVerifiedByInput}
                        onChange={(e) => setVevoVerifiedByInput(e.target.value)}
                        placeholder="Your name (manager)"
                        className="max-w-xs"
                        data-testid="input-vevo-verified-by"
                      />
                      <Button size="sm" variant="outline" onClick={handleMarkVerified} disabled={updateMutation.isPending || !vevoVerifiedByInput.trim()} data-testid="button-mark-verified">
                        {updateMutation.isPending ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" />}
                        Mark as Verified Today
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })()}

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
                      className="h-24 w-24 rounded-xl object-cover border border-border/40 shrink-0 cursor-zoom-in"
                      onClick={() => setLightboxUrl(currentData.selfieUrl!)}
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
                      className="h-24 w-24 rounded-xl object-cover border border-border/40 shrink-0 cursor-zoom-in"
                      onClick={() => setLightboxUrl(currentData.passportUrl!)}
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
              <FhcUploadSection
                value={currentData.fhc ?? null}
                onChange={(url) => handleFieldChange("fhc", url)}
              />
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

      {/* VEVO Modal */}
      {showVevoModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
          onClick={() => setShowVevoModal(false)}
          data-testid="vevo-modal-overlay"
        >
          <div className="relative w-full max-w-md mx-4 rounded-xl bg-card border border-border/40 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-border/40 px-5 py-4">
              <div className="flex items-center gap-2">
                <ShieldCheck className="h-5 w-5 text-primary" />
                <h2 className="font-semibold">VEVO — Copy Details &amp; Login</h2>
              </div>
              <Button size="icon" variant="ghost" onClick={() => setShowVevoModal(false)} data-testid="button-vevo-modal-close">
                <X className="h-4 w-4" />
              </Button>
            </div>
            <div className="p-5 space-y-4">
              <p className="text-sm text-muted-foreground">Copy each field below, then open the VEVO portal and paste into the search form.</p>
              <div className="space-y-3">
                {[
                  { label: "Passport No", value: currentData.passportNo, field: "modal-passport" },
                  { label: "Date of Birth", value: currentData.dob, field: "modal-dob" },
                  { label: "Country of Passport", value: currentData.nationality, field: "modal-nationality" },
                ].map(({ label, value, field }) => (
                  <div key={field} className="space-y-1">
                    <p className="text-xs font-medium text-muted-foreground">{label}</p>
                    <button
                      type="button"
                      onClick={() => copyToClipboard(value ?? "", field)}
                      disabled={!value}
                      className="w-full flex items-center justify-between gap-3 rounded-md border border-border/40 bg-muted/30 px-3 py-2.5 text-left hover-elevate active-elevate-2 disabled:opacity-40 disabled:cursor-not-allowed"
                      data-testid={`button-copy-${field}`}
                    >
                      <span className="font-mono text-sm">{value || <span className="text-muted-foreground italic">Not set</span>}</span>
                      {copiedField === field ? (
                        <span className="flex items-center gap-1 text-xs text-green-600 shrink-0 font-medium"><CheckCircle2 className="h-3.5 w-3.5" />Copied!</span>
                      ) : (
                        <ClipboardCopy className="h-4 w-4 text-muted-foreground shrink-0" />
                      )}
                    </button>
                  </div>
                ))}
              </div>
              <div className="border-t border-border/40 pt-4">
                <Button
                  className="w-full"
                  onClick={() => { window.open("https://online.immi.gov.au/lusc/login", "_blank"); setShowVevoModal(false); }}
                  data-testid="button-open-vevo-login"
                >
                  <ExternalLink className="h-4 w-4 mr-2" />
                  Open VEVO Organisation Login
                </Button>
                <p className="text-xs text-muted-foreground text-center mt-2">Opens: online.immi.gov.au/lusc/login</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Lightbox */}
      {lightboxUrl && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm"
          onClick={() => setLightboxUrl(null)}
          data-testid="lightbox-overlay"
        >
          <div className="relative max-w-[90vw] max-h-[90vh]" onClick={(e) => e.stopPropagation()}>
            <img
              src={lightboxUrl}
              alt="Preview"
              className="max-w-full max-h-[90vh] rounded-xl object-contain shadow-2xl"
            />
            <button
              className="absolute -top-3 -right-3 flex h-8 w-8 items-center justify-center rounded-full bg-background border border-border/40 text-foreground shadow-md hover-elevate"
              onClick={() => setLightboxUrl(null)}
              data-testid="button-lightbox-close"
            >
              ✕
            </button>
          </div>
        </div>
      )}
    </AdminLayout>
  );
}
