import { useState, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { MobileLayout } from "@/components/layouts/MobileLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
  CheckCircle2,
  Loader2,
  Camera,
  FileText,
  PenTool,
  X,
  Upload,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import type { Store, InsertEmployee } from "@shared/schema";

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

  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <div
        onClick={() => inputRef.current?.click()}
        className="relative border-2 border-dashed rounded-lg p-6 text-center cursor-pointer hover:border-primary/50 transition-colors"
        data-testid={testId}
      >
        <input
          ref={inputRef}
          type="file"
          accept={accept}
          onChange={(e) => onFileChange(e.target.files?.[0] ?? null)}
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
              onClick={(e) => {
                e.stopPropagation();
                onFileChange(null);
                if (inputRef.current) inputRef.current.value = "";
              }}
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

export function MobileDirectRegister() {
  const { toast } = useToast();
  const [showSuccess, setShowSuccess] = useState(false);
  const [formData, setFormData] = useState<Partial<InsertEmployee>>({});
  const [selfie, setSelfie] = useState<File | null>(null);
  const [passport, setPassport] = useState<File | null>(null);
  const [signature, setSignature] = useState<File | null>(null);

  const { data: stores } = useQuery<Store[]>({
    queryKey: ["/api/stores"],
  });

  const submitMutation = useMutation({
    mutationFn: async (employeeData: FormData) => {
      const res = await fetch("/api/direct-register", {
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

  if (showSuccess) {
    return (
      <MobileLayout title="Registration" showHeader={false}>
        <div className="flex flex-col items-center justify-center min-h-[60vh] text-center px-4">
          <div className="w-20 h-20 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center mb-6">
            <CheckCircle2 className="w-10 h-10 text-green-600 dark:text-green-400" />
          </div>
          <h2 className="text-2xl font-bold mb-2" data-testid="text-complete-title">
            Registration Complete
          </h2>
          <p className="text-muted-foreground mb-8 max-w-sm">
            Your registration has been completed successfully.
          </p>
          <p className="text-sm text-muted-foreground">
            You may now close this page.
          </p>
        </div>
      </MobileLayout>
    );
  }

  const activeStores = stores?.filter((s) => s.active) || [];

  return (
    <MobileLayout title="New Employee Registration">
      <form onSubmit={handleSubmit} className="space-y-6 pb-8">
        <Card>
          <CardContent className="p-4 space-y-4">
            <h3 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide">
              Personal Information
            </h3>

            <div className="space-y-2">
              <Label htmlFor="dr-nickname">Nickname</Label>
              <Input
                id="dr-nickname"
                value={formData.nickname ?? ""}
                onChange={(e) => handleChange("nickname", e.target.value)}
                placeholder="How should we call you?"
                className="h-12 text-base"
                data-testid="input-dr-nickname"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="dr-firstName">First Name *</Label>
                <Input
                  id="dr-firstName"
                  value={formData.firstName ?? ""}
                  onChange={(e) => handleChange("firstName", e.target.value)}
                  className="h-12 text-base"
                  required
                  data-testid="input-dr-first-name"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="dr-lastName">Last Name *</Label>
                <Input
                  id="dr-lastName"
                  value={formData.lastName ?? ""}
                  onChange={(e) => handleChange("lastName", e.target.value)}
                  className="h-12 text-base"
                  required
                  data-testid="input-dr-last-name"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="dr-email">Email</Label>
                <Input
                  id="dr-email"
                  type="email"
                  value={formData.email ?? ""}
                  onChange={(e) => handleChange("email", e.target.value)}
                  className="h-12 text-base"
                  data-testid="input-dr-email"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="dr-phone">Phone</Label>
                <Input
                  id="dr-phone"
                  type="tel"
                  value={formData.phone ?? ""}
                  onChange={(e) => handleChange("phone", e.target.value)}
                  className="h-12 text-base"
                  data-testid="input-dr-phone"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="dr-dob">Date of Birth</Label>
                <Input
                  id="dr-dob"
                  type="date"
                  value={formData.dob ?? ""}
                  onChange={(e) => handleChange("dob", e.target.value)}
                  className="h-12 text-base"
                  data-testid="input-dr-dob"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="dr-gender">Gender</Label>
                <Select
                  value={formData.gender ?? ""}
                  onValueChange={(value) => handleChange("gender", value)}
                >
                  <SelectTrigger className="h-12 text-base" data-testid="select-dr-gender">
                    <SelectValue placeholder="Select" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Male">Male</SelectItem>
                    <SelectItem value="Female">Female</SelectItem>
                    <SelectItem value="Other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="dr-maritalStatus">Marital Status</Label>
              <Select
                value={formData.maritalStatus ?? ""}
                onValueChange={(value) => handleChange("maritalStatus", value)}
              >
                <SelectTrigger className="h-12 text-base" data-testid="select-dr-marital">
                  <SelectValue placeholder="Select" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Single">Single</SelectItem>
                  <SelectItem value="Married">Married</SelectItem>
                  <SelectItem value="Divorced">Divorced</SelectItem>
                  <SelectItem value="Widowed">Widowed</SelectItem>
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
              <Label htmlFor="dr-streetAddress">Street Address</Label>
              <Input
                id="dr-streetAddress"
                value={formData.streetAddress ?? ""}
                onChange={(e) => handleChange("streetAddress", e.target.value)}
                placeholder="123 Main Street"
                className="h-12 text-base"
                data-testid="input-dr-street"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="dr-streetAddress2">Address Line 2</Label>
              <Input
                id="dr-streetAddress2"
                value={formData.streetAddress2 ?? ""}
                onChange={(e) => handleChange("streetAddress2", e.target.value)}
                placeholder="Apartment, unit, etc."
                className="h-12 text-base"
                data-testid="input-dr-street2"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="dr-suburb">Suburb</Label>
                <Input
                  id="dr-suburb"
                  value={formData.suburb ?? ""}
                  onChange={(e) => handleChange("suburb", e.target.value)}
                  className="h-12 text-base"
                  data-testid="input-dr-suburb"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="dr-state">State</Label>
                <Select
                  value={formData.state ?? ""}
                  onValueChange={(value) => handleChange("state", value)}
                >
                  <SelectTrigger className="h-12 text-base" data-testid="select-dr-state">
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
              <Label htmlFor="dr-postCode">Post Code</Label>
              <Input
                id="dr-postCode"
                value={formData.postCode ?? ""}
                onChange={(e) => handleChange("postCode", e.target.value)}
                className="h-12 text-base"
                data-testid="input-dr-postcode"
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
                <Label htmlFor="dr-visaType">Visa Type</Label>
                <Select
                  value={formData.visaType ?? ""}
                  onValueChange={(val) => handleChange("visaType", val)}
                >
                  <SelectTrigger className="h-12 text-base" data-testid="select-dr-visa-type">
                    <SelectValue placeholder="Select" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Student">Student</SelectItem>
                    <SelectItem value="PR">PR</SelectItem>
                    <SelectItem value="CTZ">CTZ</SelectItem>
                    <SelectItem value="Other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="dr-visaExpiry">Expiry Date</Label>
                <Input
                  id="dr-visaExpiry"
                  type="date"
                  value={formData.visaExpiry ?? ""}
                  onChange={(e) => handleChange("visaExpiry", e.target.value)}
                  className="h-12 text-base"
                  data-testid="input-dr-visa-expiry"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="dr-lineId">LINE ID</Label>
                <Input
                  id="dr-lineId"
                  value={formData.lineId ?? ""}
                  onChange={(e) => handleChange("lineId", e.target.value)}
                  className="h-12 text-base"
                  data-testid="input-dr-line-id"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="dr-typeOfContact">Contact Type</Label>
                <Select
                  value={formData.typeOfContact ?? ""}
                  onValueChange={(value) => handleChange("typeOfContact", value)}
                >
                  <SelectTrigger className="h-12 text-base" data-testid="select-dr-contact-type">
                    <SelectValue placeholder="Select" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Phone">Phone</SelectItem>
                    <SelectItem value="Email">Email</SelectItem>
                    <SelectItem value="LINE">LINE</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4 space-y-4">
            <h3 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide">
              Banking Information
            </h3>

            <div className="space-y-2">
              <Label htmlFor="dr-tfn">Tax File Number (TFN)</Label>
              <Input
                id="dr-tfn"
                value={formData.tfn ?? ""}
                onChange={(e) => handleChange("tfn", e.target.value)}
                className="h-12 text-base"
                data-testid="input-dr-tfn"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="dr-bsb">BSB</Label>
                <Input
                  id="dr-bsb"
                  value={formData.bsb ?? ""}
                  onChange={(e) => handleChange("bsb", e.target.value)}
                  className="h-12 text-base"
                  data-testid="input-dr-bsb"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="dr-accountNo">Account Number</Label>
                <Input
                  id="dr-accountNo"
                  value={formData.accountNo ?? ""}
                  onChange={(e) => handleChange("accountNo", e.target.value)}
                  className="h-12 text-base"
                  data-testid="input-dr-account-no"
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
              <Label htmlFor="dr-superCompany">Super Company</Label>
              <Input
                id="dr-superCompany"
                value={formData.superCompany ?? ""}
                onChange={(e) => handleChange("superCompany", e.target.value)}
                className="h-12 text-base"
                data-testid="input-dr-super-company"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="dr-superMembershipNo">Membership Number</Label>
              <Input
                id="dr-superMembershipNo"
                value={formData.superMembershipNo ?? ""}
                onChange={(e) => handleChange("superMembershipNo", e.target.value)}
                className="h-12 text-base"
                data-testid="input-dr-super-membership"
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
              testId="upload-dr-selfie"
            />

            <FileUploadArea
              label="Passport Cover"
              icon={FileText}
              file={passport}
              onFileChange={setPassport}
              accept="image/*,.pdf"
              testId="upload-dr-passport"
            />

            <div className="rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-700 p-4 space-y-3 text-sm">
              <p className="font-semibold text-amber-900 dark:text-amber-300 uppercase tracking-wide text-xs">
                Employment Terms &amp; Conditions — Please Read Before Signing
              </p>

              <div className="space-y-3 text-foreground">
                <div>
                  <p className="font-semibold">1. Notice of Resignation</p>
                  <p className="text-muted-foreground mt-0.5">Employees must provide notice of their resignation in accordance with the relevant Fair Work Award. If an employee over 18 years old fails to provide the required notice, the company reserves the right to deduct up to one week's wages from their final pay, strictly as permitted by the applicable Award.</p>
                </div>

                <div>
                  <p className="font-semibold">2. Return of Company Property</p>
                  <p className="text-muted-foreground mt-0.5">Upon termination of employment, employees must return all company property in their possession, including but not limited to uniforms, hats, masks, and keys, in a clean and reasonable condition.</p>
                </div>

                <div>
                  <p className="font-semibold">3. Confidentiality</p>
                  <p className="text-muted-foreground mt-0.5">Employees must keep all confidential information obtained during their employment strictly private. This includes, but is not limited to, financial data, sales figures, employee personal details, rosters, recipes, and supplier information.</p>
                </div>

                <div>
                  <p className="font-semibold">4. Zero Tolerance for Theft and Fraud</p>
                  <p className="text-muted-foreground mt-0.5">The company has a strict zero-tolerance policy regarding theft, fraud, or the mishandling of company funds or property. Any such incidents will result in immediate termination of employment and will be reported to the police for legal action.</p>
                </div>

                <div>
                  <p className="font-semibold">5. Workplace Surveillance</p>
                  <p className="text-muted-foreground mt-0.5">Employees are advised that the premises are equipped with continuous video and audio surveillance cameras for the purpose of health, safety, and crime deterrence. By signing this agreement, you acknowledge and consent to being monitored by these cameras while on the premises.</p>
                </div>

                <div>
                  <p className="font-semibold">6. Attendance and Rostering</p>
                  <p className="text-muted-foreground mt-0.5">Employees are expected to arrive on time and follow their assigned roster. In the event of illness or an unavoidable emergency requiring a schedule change, the employee must notify the Store Manager directly by phone call as soon as practicably possible prior to the shift.</p>
                </div>

                <div>
                  <p className="font-semibold">7. Probationary Period</p>
                  <p className="text-muted-foreground mt-0.5">All new employees are subject to a standard probation period. During this time, both the employer and employee may evaluate the working relationship. During the probation period, employment may be terminated by either party with the appropriate notice as per the relevant Fair Work Award.</p>
                </div>
              </div>

              <p className="text-xs text-amber-800 dark:text-amber-400 font-medium pt-1">
                By uploading your signature below, you confirm that you have read, understood, and agree to all of the above terms and conditions.
              </p>
            </div>

            <FileUploadArea
              label="Signature"
              icon={PenTool}
              file={signature}
              onFileChange={setSignature}
              accept="image/*"
              testId="upload-dr-signature"
            />
          </CardContent>
        </Card>

        <Button
          type="submit"
          size="lg"
          className="w-full h-14 text-base font-semibold"
          disabled={submitMutation.isPending}
          data-testid="button-dr-submit"
        >
          {submitMutation.isPending ? (
            <Loader2 className="w-5 h-5 mr-2 animate-spin" />
          ) : (
            <Upload className="w-5 h-5 mr-2" />
          )}
          Submit Registration
        </Button>
      </form>
    </MobileLayout>
  );
}
