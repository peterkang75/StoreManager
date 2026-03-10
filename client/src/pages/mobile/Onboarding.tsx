import { useState, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useRoute } from "wouter";
import { MobileLayout } from "@/components/layouts/MobileLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { 
  CheckCircle2, 
  Loader2, 
  AlertCircle, 
  Camera,
  FileText,
  PenTool,
  X,
  Upload
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import type { Candidate, Store, InsertEmployee } from "@shared/schema";

interface OnboardingData {
  candidate: Candidate;
  stores: Store[];
}

function FileUploadArea({
  label,
  icon: Icon,
  file,
  onFileChange,
  accept,
  testId,
}: {
  label: string;
  icon: React.ElementType;
  file: File | null;
  onFileChange: (file: File | null) => void;
  accept: string;
  testId: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  const handleClick = () => {
    inputRef.current?.click();
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0] ?? null;
    onFileChange(selectedFile);
  };

  const handleRemove = (e: React.MouseEvent) => {
    e.stopPropagation();
    onFileChange(null);
    if (inputRef.current) {
      inputRef.current.value = "";
    }
  };

  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <div
        onClick={handleClick}
        className="relative border-2 border-dashed rounded-lg p-6 text-center cursor-pointer hover:border-primary/50 transition-colors"
        data-testid={testId}
      >
        <input
          ref={inputRef}
          type="file"
          accept={accept}
          onChange={handleChange}
          className="hidden"
        />
        {file ? (
          <div className="flex items-center justify-center gap-3">
            <div className="w-10 h-10 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
              <CheckCircle2 className="w-5 h-5 text-green-600" />
            </div>
            <div className="text-left flex-1 min-w-0">
              <p className="font-medium truncate">{file.name}</p>
              <p className="text-sm text-muted-foreground">
                {(file.size / 1024).toFixed(1)} KB
              </p>
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={handleRemove}
              className="shrink-0"
            >
              <X className="w-4 h-4" />
            </Button>
          </div>
        ) : (
          <>
            <Icon className="w-8 h-8 mx-auto mb-2 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              Tap to upload or take photo
            </p>
          </>
        )}
      </div>
    </div>
  );
}

function SuccessScreen() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] text-center px-4">
      <div className="w-20 h-20 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center mb-6">
        <CheckCircle2 className="w-10 h-10 text-green-600 dark:text-green-400" />
      </div>
      <h2 className="text-2xl font-bold mb-2" data-testid="text-complete-title">
        Onboarding Complete
      </h2>
      <p className="text-muted-foreground mb-8 max-w-sm">
        온보딩을 완료해 주셔서 감사합니다. 정보가 성공적으로 제출되었습니다.
      </p>
      <p className="text-sm text-muted-foreground">
        이제 이 페이지를 닫으셔도 됩니다.
      </p>
    </div>
  );
}

function InvalidTokenScreen() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] text-center px-4">
      <div className="w-20 h-20 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center mb-6">
        <AlertCircle className="w-10 h-10 text-red-600 dark:text-red-400" />
      </div>
      <h2 className="text-2xl font-bold mb-2" data-testid="text-error-title">
        유효하지 않거나 만료된 링크
      </h2>
      <p className="text-muted-foreground max-w-sm">
        이 온보딩 링크는 유효하지 않거나 만료되었거나 이미 사용되었습니다. 관리자에게 새 링크를 요청하세요.
      </p>
    </div>
  );
}

export function MobileOnboarding() {
  const { toast } = useToast();
  const [, params] = useRoute("/m/onboarding/:token");
  const token = params?.token;

  const [showSuccess, setShowSuccess] = useState(false);
  const [formData, setFormData] = useState<Partial<InsertEmployee>>({});
  const [selfie, setSelfie] = useState<File | null>(null);
  const [passport, setPassport] = useState<File | null>(null);
  const [signature, setSignature] = useState<File | null>(null);

  const { data, isLoading, error } = useQuery<OnboardingData>({
    queryKey: ["/api/onboarding", token],
    enabled: !!token,
    retry: false,
  });

  const submitMutation = useMutation({
    mutationFn: async (employeeData: FormData) => {
      const res = await fetch(`/api/onboarding/${token}`, {
        method: "POST",
        body: employeeData,
        credentials: "include",
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || res.statusText);
      }
      return res.json();
    },
    onSuccess: () => {
      setShowSuccess(true);
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const handleChange = (field: keyof InsertEmployee, value: string | null) => {
    setFormData({ ...formData, [field]: value });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!formData.firstName?.trim() || !formData.lastName?.trim()) {
      toast({ title: "Error", description: "First and last name are required", variant: "destructive" });
      return;
    }

    const fd = new FormData();
    
    Object.entries(formData).forEach(([key, value]) => {
      if (value !== null && value !== undefined && value !== "") {
        fd.append(key, String(value));
      }
    });

    if (selfie) fd.append("selfie", selfie);
    if (passport) fd.append("passport", passport);
    if (signature) fd.append("signature", signature);

    submitMutation.mutate(fd);
  };

  if (isLoading) {
    return (
      <MobileLayout title="Onboarding">
        <div className="space-y-4">
          {[...Array(4)].map((_, i) => (
            <Skeleton key={i} className="h-32 w-full" />
          ))}
        </div>
      </MobileLayout>
    );
  }

  if (error || !data) {
    return (
      <MobileLayout title="Onboarding" showHeader={false}>
        <InvalidTokenScreen />
      </MobileLayout>
    );
  }

  if (showSuccess) {
    return (
      <MobileLayout title="Onboarding" showHeader={false}>
        <SuccessScreen />
      </MobileLayout>
    );
  }

  const { candidate, stores } = data;
  const currentData = {
    ...formData,
    firstName: formData.firstName ?? candidate.name.split(" ")[0] ?? "",
    lastName: formData.lastName ?? candidate.name.split(" ").slice(1).join(" ") ?? "",
    dob: formData.dob ?? candidate.dob ?? "",
    gender: formData.gender ?? candidate.gender ?? "",
    visaType: formData.visaType ?? candidate.visaType ?? "",
    visaExpiry: formData.visaExpiry ?? candidate.visaExpiry ?? "",
    rate: formData.rate ?? candidate.desiredRate ?? "",
  };

  return (
    <MobileLayout title="Employee Onboarding">
      <form onSubmit={handleSubmit} className="space-y-6 pb-8">
        <Card>
          <CardContent className="p-4 space-y-4">
            <h3 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide">
              Personal Information
            </h3>

            <div className="space-y-2">
              <Label htmlFor="nickname">Nickname</Label>
              <Input
                id="nickname"
                value={currentData.nickname ?? ""}
                onChange={(e) => handleChange("nickname", e.target.value)}
                placeholder="How should we call you?"
                className="h-12 text-base"
                data-testid="input-nickname"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="firstName">First Name *</Label>
                <Input
                  id="firstName"
                  value={currentData.firstName}
                  onChange={(e) => handleChange("firstName", e.target.value)}
                  className="h-12 text-base"
                  required
                  data-testid="input-first-name"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="lastName">Last Name *</Label>
                <Input
                  id="lastName"
                  value={currentData.lastName}
                  onChange={(e) => handleChange("lastName", e.target.value)}
                  className="h-12 text-base"
                  required
                  data-testid="input-last-name"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  value={currentData.email ?? ""}
                  onChange={(e) => handleChange("email", e.target.value)}
                  className="h-12 text-base"
                  data-testid="input-email"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="phone">Phone</Label>
                <Input
                  id="phone"
                  type="tel"
                  value={currentData.phone ?? ""}
                  onChange={(e) => handleChange("phone", e.target.value)}
                  className="h-12 text-base"
                  data-testid="input-phone"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="dob">Date of Birth</Label>
                <Input
                  id="dob"
                  type="date"
                  value={currentData.dob ?? ""}
                  onChange={(e) => handleChange("dob", e.target.value)}
                  className="h-12 text-base"
                  data-testid="input-dob"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="gender">Gender</Label>
                <Select
                  value={currentData.gender ?? ""}
                  onValueChange={(value) => handleChange("gender", value)}
                >
                  <SelectTrigger className="h-12 text-base" data-testid="select-gender">
                    <SelectValue placeholder="Select" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="male">Male</SelectItem>
                    <SelectItem value="female">Female</SelectItem>
                    <SelectItem value="other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="maritalStatus">Marital Status</Label>
              <Select
                value={currentData.maritalStatus ?? ""}
                onValueChange={(value) => handleChange("maritalStatus", value)}
              >
                <SelectTrigger className="h-12 text-base" data-testid="select-marital">
                  <SelectValue placeholder="Select" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="single">Single</SelectItem>
                  <SelectItem value="married">Married</SelectItem>
                  <SelectItem value="divorced">Divorced</SelectItem>
                  <SelectItem value="widowed">Widowed</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4 space-y-4">
            <h3 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide">
              Address
            </h3>

            <div className="space-y-2">
              <Label htmlFor="streetAddress">Street Address</Label>
              <Input
                id="streetAddress"
                value={currentData.streetAddress ?? ""}
                onChange={(e) => handleChange("streetAddress", e.target.value)}
                placeholder="123 Main Street"
                className="h-12 text-base"
                data-testid="input-street"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="streetAddress2">Address Line 2</Label>
              <Input
                id="streetAddress2"
                value={currentData.streetAddress2 ?? ""}
                onChange={(e) => handleChange("streetAddress2", e.target.value)}
                placeholder="Apartment, unit, etc."
                className="h-12 text-base"
                data-testid="input-street2"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="suburb">Suburb</Label>
                <Input
                  id="suburb"
                  value={currentData.suburb ?? ""}
                  onChange={(e) => handleChange("suburb", e.target.value)}
                  className="h-12 text-base"
                  data-testid="input-suburb"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="state">State</Label>
                <Select
                  value={currentData.state ?? ""}
                  onValueChange={(value) => handleChange("state", value)}
                >
                  <SelectTrigger className="h-12 text-base" data-testid="select-state">
                    <SelectValue placeholder="Select" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="NSW">NSW</SelectItem>
                    <SelectItem value="VIC">VIC</SelectItem>
                    <SelectItem value="QLD">QLD</SelectItem>
                    <SelectItem value="WA">WA</SelectItem>
                    <SelectItem value="SA">SA</SelectItem>
                    <SelectItem value="TAS">TAS</SelectItem>
                    <SelectItem value="ACT">ACT</SelectItem>
                    <SelectItem value="NT">NT</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="postCode">Post Code</Label>
              <Input
                id="postCode"
                value={currentData.postCode ?? ""}
                onChange={(e) => handleChange("postCode", e.target.value)}
                className="h-12 text-base"
                data-testid="input-postcode"
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4 space-y-4">
            <h3 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide">
              Visa & Contact
            </h3>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="visaType">Visa Type</Label>
                <Select
                  value={currentData.visaType ?? ""}
                  onValueChange={(val) => handleChange("visaType", val)}
                >
                  <SelectTrigger className="h-12 text-base" data-testid="select-visa-type">
                    <SelectValue placeholder="Select" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Student">Student</SelectItem>
                    <SelectItem value="PR/CTZ">PR/CTZ</SelectItem>
                    <SelectItem value="PR">PR</SelectItem>
                    <SelectItem value="CTZ">CTZ</SelectItem>
                    <SelectItem value="Other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="visaExpiry">Expiry Date</Label>
                <Input
                  id="visaExpiry"
                  type="date"
                  value={currentData.visaExpiry ?? ""}
                  onChange={(e) => handleChange("visaExpiry", e.target.value)}
                  className="h-12 text-base"
                  data-testid="input-visa-expiry"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="lineId">LINE ID</Label>
                <Input
                  id="lineId"
                  value={currentData.lineId ?? ""}
                  onChange={(e) => handleChange("lineId", e.target.value)}
                  className="h-12 text-base"
                  data-testid="input-line-id"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="typeOfContact">Contact Type</Label>
                <Select
                  value={currentData.typeOfContact ?? ""}
                  onValueChange={(value) => handleChange("typeOfContact", value)}
                >
                  <SelectTrigger className="h-12 text-base" data-testid="select-contact-type">
                    <SelectValue placeholder="Select" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="phone">Phone</SelectItem>
                    <SelectItem value="email">Email</SelectItem>
                    <SelectItem value="line">LINE</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4 space-y-4">
            <h3 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide">
              Employment Details
            </h3>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="rate">Rate</Label>
                <Input
                  id="rate"
                  value={currentData.rate ?? ""}
                  onChange={(e) => handleChange("rate", e.target.value)}
                  placeholder="$25/hr"
                  className="h-12 text-base"
                  data-testid="input-rate"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="fixedAmount">Fixed Amount</Label>
                <Input
                  id="fixedAmount"
                  value={currentData.fixedAmount ?? ""}
                  onChange={(e) => handleChange("fixedAmount", e.target.value)}
                  className="h-12 text-base"
                  data-testid="input-fixed-amount"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="contractPosition">Position</Label>
                <Input
                  id="contractPosition"
                  value={currentData.contractPosition ?? ""}
                  onChange={(e) => handleChange("contractPosition", e.target.value)}
                  className="h-12 text-base"
                  data-testid="input-position"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="fhc">FHC</Label>
                <Input
                  id="fhc"
                  value={currentData.fhc ?? ""}
                  onChange={(e) => handleChange("fhc", e.target.value)}
                  className="h-12 text-base"
                  data-testid="input-fhc"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="salaryType">Salary Type</Label>
                <Select
                  value={currentData.salaryType ?? ""}
                  onValueChange={(value) => handleChange("salaryType", value)}
                >
                  <SelectTrigger className="h-12 text-base" data-testid="select-salary-type">
                    <SelectValue placeholder="Select" />
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
                  onChange={(e) => handleChange("annualLeave", e.target.value)}
                  placeholder="20 days"
                  className="h-12 text-base"
                  data-testid="input-annual-leave"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="storeId">Assigned Store</Label>
              <Select
                value={currentData.storeId ?? ""}
                onValueChange={(value) => handleChange("storeId", value)}
              >
                <SelectTrigger className="h-12 text-base" data-testid="select-store">
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
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4 space-y-4">
            <h3 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide">
              Banking Information
            </h3>

            <div className="space-y-2">
              <Label htmlFor="tfn">Tax File Number (TFN)</Label>
              <Input
                id="tfn"
                value={currentData.tfn ?? ""}
                onChange={(e) => handleChange("tfn", e.target.value)}
                className="h-12 text-base"
                data-testid="input-tfn"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="bsb">BSB</Label>
                <Input
                  id="bsb"
                  value={currentData.bsb ?? ""}
                  onChange={(e) => handleChange("bsb", e.target.value)}
                  className="h-12 text-base"
                  data-testid="input-bsb"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="accountNo">Account Number</Label>
                <Input
                  id="accountNo"
                  value={currentData.accountNo ?? ""}
                  onChange={(e) => handleChange("accountNo", e.target.value)}
                  className="h-12 text-base"
                  data-testid="input-account-no"
                />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4 space-y-4">
            <h3 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide">
              Superannuation
            </h3>

            <div className="space-y-2">
              <Label htmlFor="superCompany">Super Company</Label>
              <Input
                id="superCompany"
                value={currentData.superCompany ?? ""}
                onChange={(e) => handleChange("superCompany", e.target.value)}
                className="h-12 text-base"
                data-testid="input-super-company"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="superMembershipNo">Membership Number</Label>
              <Input
                id="superMembershipNo"
                value={currentData.superMembershipNo ?? ""}
                onChange={(e) => handleChange("superMembershipNo", e.target.value)}
                className="h-12 text-base"
                data-testid="input-super-membership"
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4 space-y-4">
            <h3 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide">
              Documents
            </h3>

            <FileUploadArea
              label="Selfie Photo"
              icon={Camera}
              file={selfie}
              onFileChange={setSelfie}
              accept="image/*"
              testId="upload-selfie"
            />

            <FileUploadArea
              label="Passport Cover"
              icon={FileText}
              file={passport}
              onFileChange={setPassport}
              accept="image/*,.pdf"
              testId="upload-passport"
            />

            <FileUploadArea
              label="Signature"
              icon={PenTool}
              file={signature}
              onFileChange={setSignature}
              accept="image/*"
              testId="upload-signature"
            />
          </CardContent>
        </Card>

        <Button
          type="submit"
          size="lg"
          className="w-full h-14 text-base font-semibold"
          disabled={submitMutation.isPending}
          data-testid="button-submit"
        >
          {submitMutation.isPending ? (
            <Loader2 className="w-5 h-5 mr-2 animate-spin" />
          ) : (
            <Upload className="w-5 h-5 mr-2" />
          )}
          Complete Onboarding
        </Button>
      </form>
    </MobileLayout>
  );
}
