import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { MobileLayout } from "@/components/layouts/MobileLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
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
  ClipboardCheck,
  Send,
  Copy,
  Check,
  XCircle,
  ThumbsUp,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { InsertCandidate } from "@shared/schema";

const DAYS = [
  { key: "mon", label: "Mon" },
  { key: "tue", label: "Tue" },
  { key: "wed", label: "Wed" },
  { key: "thu", label: "Thu" },
  { key: "fri", label: "Fri" },
  { key: "sat", label: "Sat" },
  { key: "sun", label: "Sun" },
] as const;

type DayKey = (typeof DAYS)[number]["key"];
type AvailabilitySlot = "NONE" | "MORNING" | "AFTERNOON" | "ALLDAY";
type AvailabilityDays = Record<DayKey, AvailabilitySlot>;

const SLOTS: { value: AvailabilitySlot; label: string }[] = [
  { value: "NONE", label: "—" },
  { value: "MORNING", label: "AM" },
  { value: "AFTERNOON", label: "PM" },
  { value: "ALLDAY", label: "All" },
];

const BLANK_AVAILABILITY: AvailabilityDays = {
  mon: "NONE", tue: "NONE", wed: "NONE", thu: "NONE",
  fri: "NONE", sat: "NONE", sun: "NONE",
};

type InterviewDecision = "PENDING" | "HIRE" | "REJECT";

interface FormState {
  name: string;
  phone: string;
  gender: string;
  birthYear: string;
  nationality: string;
  visaType: string;
  visaExpiryMonth: string;
  hasExperience: boolean;
  experience: string;
  availabilityDays: AvailabilityDays;
  availabilityCommitment: string;
  desiredRate: string;
  interviewNotes: string;
  decision: InterviewDecision;
}

const BLANK_FORM: FormState = {
  name: "",
  phone: "",
  gender: "",
  birthYear: "",
  nationality: "",
  visaType: "",
  visaExpiryMonth: "",
  hasExperience: false,
  experience: "",
  availabilityDays: { ...BLANK_AVAILABILITY },
  availabilityCommitment: "",
  desiredRate: "",
  interviewNotes: "",
  decision: "PENDING",
};

function toInsertCandidate(f: FormState): InsertCandidate {
  const year = parseInt(f.birthYear.trim(), 10);
  return {
    name: f.name.trim(),
    phone: f.phone.trim() || null,
    gender: f.gender || null,
    birthYear: Number.isFinite(year) ? year : null,
    nationality: f.nationality.trim() || null,
    visaType: f.visaType || null,
    visaExpiryMonth: f.visaExpiryMonth || null,
    hasExperience: f.hasExperience,
    experience: f.hasExperience ? (f.experience.trim() || null) : null,
    availabilityDays: f.availabilityDays,
    availabilityCommitment: f.availabilityCommitment.trim() || null,
    desiredRate: f.desiredRate.trim() || null,
    interviewNotes: f.interviewNotes.trim() || null,
    hireDecision: f.decision === "PENDING" ? "PENDING" : f.decision,
  } as InsertCandidate;
}

export function MobileInterview() {
  const { toast } = useToast();
  const [form, setForm] = useState<FormState>(BLANK_FORM);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [onboardingUrl, setOnboardingUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function setDay(day: DayKey, slot: AvailabilitySlot) {
    setForm((prev) => ({
      ...prev,
      availabilityDays: { ...prev.availabilityDays, [day]: slot },
    }));
  }

  const saveMutation = useMutation({
    mutationFn: async (data: InsertCandidate) => {
      const res = await apiRequest("POST", "/api/candidates", data);
      return res.json();
    },
    onSuccess: (candidate: { id: string }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/candidates"] });
      setSavedId(candidate.id);
      if (form.decision === "HIRE") {
        hireMutation.mutate(candidate.id);
      } else if (form.decision === "REJECT") {
        toast({ title: "Saved as rejected" });
      } else {
        toast({ title: "Interview saved" });
      }
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const hireMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("POST", `/api/candidates/${id}/hire`);
      return res.json();
    },
    onSuccess: (data: { onboardingUrl: string }) => {
      const fullUrl = `${window.location.origin}${data.onboardingUrl}`;
      setOnboardingUrl(fullUrl);
      toast({ title: "Ready to send onboarding link" });
    },
    onError: (err: Error) => {
      toast({ title: "Hire failed", description: err.message, variant: "destructive" });
    },
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) {
      toast({ title: "Name is required", variant: "destructive" });
      return;
    }
    if (form.decision === "HIRE" && !form.phone.trim()) {
      toast({
        title: "Phone number required",
        description: "A mobile number is needed to send the onboarding form.",
        variant: "destructive",
      });
      return;
    }
    saveMutation.mutate(toInsertCandidate(form));
  }

  function handleSendForm() {
    if (!onboardingUrl) return;
    // Phase B will swap this out for POST /api/candidates/:id/send-form-sms.
    navigator.clipboard.writeText(onboardingUrl);
    setCopied(true);
    toast({
      title: "Link copied",
      description: `Share this link with ${form.name}. SMS delivery coming soon.`,
    });
    setTimeout(() => setCopied(false), 2500);
  }

  function handleReset() {
    setForm(BLANK_FORM);
    setSavedId(null);
    setOnboardingUrl(null);
    setCopied(false);
  }

  const isPending = saveMutation.isPending || hireMutation.isPending;
  const showSendForm = savedId && form.decision === "HIRE" && onboardingUrl;
  const showSuccess = savedId && form.decision !== "HIRE";

  if (showSuccess) {
    return (
      <MobileLayout title="Interview" showHeader={false}>
        <div className="flex flex-col items-center justify-center min-h-[60vh] text-center px-4">
          <div className="w-20 h-20 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center mb-6">
            <CheckCircle2 className="w-10 h-10 text-green-600 dark:text-green-400" />
          </div>
          <h2 className="text-2xl font-bold mb-2">Interview Saved</h2>
          <p className="text-muted-foreground mb-8 max-w-sm">
            {form.decision === "REJECT"
              ? "The candidate has been recorded as rejected."
              : "The interview has been recorded. You can continue with the next candidate."}
          </p>
          <Button size="lg" className="w-full max-w-xs h-14 text-base" onClick={handleReset}>
            <ClipboardCheck className="w-5 h-5 mr-2" />
            New Interview
          </Button>
        </div>
      </MobileLayout>
    );
  }

  return (
    <MobileLayout title="Candidate Interview">
      <form onSubmit={handleSubmit} className="space-y-5 pb-8">
        {/* Basic */}
        <Card>
          <CardContent className="p-4 space-y-4">
            <h3 className="font-semibold text-xs text-muted-foreground uppercase tracking-wide">Basic</h3>
            <div className="space-y-2">
              <Label htmlFor="name">Full Name *</Label>
              <Input
                id="name"
                value={form.name}
                onChange={(e) => update("name", e.target.value)}
                placeholder="Candidate's full name"
                className="h-12 text-base"
                required
                data-testid="input-name"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="phone">Mobile Number *</Label>
              <Input
                id="phone"
                type="tel"
                inputMode="tel"
                value={form.phone}
                onChange={(e) => update("phone", e.target.value)}
                placeholder="0412 345 678"
                className="h-12 text-base"
                data-testid="input-phone"
              />
              <p className="text-xs text-muted-foreground">
                Used to send the onboarding form link if hired.
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Personal */}
        <Card>
          <CardContent className="p-4 space-y-4">
            <h3 className="font-semibold text-xs text-muted-foreground uppercase tracking-wide">Personal</h3>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="gender">Gender</Label>
                <Select value={form.gender} onValueChange={(v) => update("gender", v)}>
                  <SelectTrigger id="gender" className="h-12 text-base" data-testid="select-gender">
                    <SelectValue placeholder="Select" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="male">Male</SelectItem>
                    <SelectItem value="female">Female</SelectItem>
                    <SelectItem value="other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="birthYear">Birth Year</Label>
                <Input
                  id="birthYear"
                  type="number"
                  inputMode="numeric"
                  min={1940}
                  max={new Date().getFullYear()}
                  value={form.birthYear}
                  onChange={(e) => update("birthYear", e.target.value)}
                  placeholder="e.g., 1998"
                  className="h-12 text-base"
                  data-testid="input-birth-year"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="nationality">Nationality</Label>
              <Input
                id="nationality"
                value={form.nationality}
                onChange={(e) => update("nationality", e.target.value)}
                placeholder="e.g., Australian, Korean"
                className="h-12 text-base"
                data-testid="input-nationality"
              />
            </div>
          </CardContent>
        </Card>

        {/* Visa */}
        <Card>
          <CardContent className="p-4 space-y-4">
            <h3 className="font-semibold text-xs text-muted-foreground uppercase tracking-wide">Visa</h3>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="visaType">Visa Type</Label>
                <Select value={form.visaType} onValueChange={(v) => update("visaType", v)}>
                  <SelectTrigger id="visaType" className="h-12 text-base" data-testid="select-visa-type">
                    <SelectValue placeholder="Select" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Student">Student</SelectItem>
                    <SelectItem value="WHV">Working Holiday</SelectItem>
                    <SelectItem value="PR">PR</SelectItem>
                    <SelectItem value="CTZ">Citizen</SelectItem>
                    <SelectItem value="Other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="visaExpiryMonth">Visa Expiry Month</Label>
                <Input
                  id="visaExpiryMonth"
                  type="month"
                  value={form.visaExpiryMonth}
                  onChange={(e) => update("visaExpiryMonth", e.target.value)}
                  className="h-12 text-base"
                  data-testid="input-visa-expiry-month"
                />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Experience */}
        <Card>
          <CardContent className="p-4 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-xs text-muted-foreground uppercase tracking-wide">Experience</h3>
              <div className="flex items-center gap-2">
                <Label htmlFor="hasExperience" className="text-sm font-normal">
                  {form.hasExperience ? "Yes" : "No"}
                </Label>
                <Switch
                  id="hasExperience"
                  checked={form.hasExperience}
                  onCheckedChange={(v) => update("hasExperience", v)}
                  data-testid="switch-has-experience"
                />
              </div>
            </div>
            {form.hasExperience && (
              <div className="space-y-2">
                <Label htmlFor="experience">Details</Label>
                <Textarea
                  id="experience"
                  value={form.experience}
                  onChange={(e) => update("experience", e.target.value)}
                  placeholder="Where, role, duration, tasks…"
                  className="min-h-[90px] text-base"
                  data-testid="input-experience"
                />
              </div>
            )}
          </CardContent>
        </Card>

        {/* Availability */}
        <Card>
          <CardContent className="p-4 space-y-4">
            <h3 className="font-semibold text-xs text-muted-foreground uppercase tracking-wide">Availability</h3>
            <div className="space-y-2">
              {DAYS.map((d) => {
                const current = form.availabilityDays[d.key];
                return (
                  <div key={d.key} className="flex items-center gap-2">
                    <span className="w-10 text-sm font-medium shrink-0">{d.label}</span>
                    <div className="flex gap-1.5 flex-1">
                      {SLOTS.map((slot) => {
                        const active = current === slot.value;
                        return (
                          <button
                            key={slot.value}
                            type="button"
                            onClick={() => setDay(d.key, slot.value)}
                            className={`flex-1 h-9 rounded-md text-xs font-medium border transition-colors ${
                              active
                                ? "bg-primary text-primary-foreground border-primary"
                                : "bg-background text-muted-foreground border-border hover:bg-muted"
                            }`}
                            data-testid={`pill-${d.key}-${slot.value.toLowerCase()}`}
                          >
                            {slot.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="space-y-2 pt-2">
              <Label htmlFor="availabilityCommitment">How long can you keep this schedule?</Label>
              <Input
                id="availabilityCommitment"
                value={form.availabilityCommitment}
                onChange={(e) => update("availabilityCommitment", e.target.value)}
                placeholder="e.g., 6 months, until end of semester"
                className="h-12 text-base"
                data-testid="input-availability-commitment"
              />
            </div>
          </CardContent>
        </Card>

        {/* Official only */}
        <Card className="border-dashed border-amber-400/50 bg-amber-50/40 dark:bg-amber-950/10">
          <CardContent className="p-4 space-y-4">
            <h3 className="font-semibold text-xs uppercase tracking-wide text-amber-700 dark:text-amber-400">
              Official Only (hidden from candidate)
            </h3>
            <div className="space-y-2">
              <Label htmlFor="desiredRate">Interview Salary</Label>
              <Input
                id="desiredRate"
                value={form.desiredRate}
                onChange={(e) => update("desiredRate", e.target.value)}
                placeholder="e.g., $25/hr cash, $28/hr on-books"
                className="h-12 text-base"
                data-testid="input-rate"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="interviewNotes">Interviewer Memo</Label>
              <Textarea
                id="interviewNotes"
                value={form.interviewNotes}
                onChange={(e) => update("interviewNotes", e.target.value)}
                placeholder="Impression, concerns, follow-ups…"
                className="min-h-[100px] text-base"
                data-testid="input-notes"
              />
            </div>
          </CardContent>
        </Card>

        {/* Decision */}
        <Card>
          <CardContent className="p-4 space-y-4">
            <h3 className="font-semibold text-xs text-muted-foreground uppercase tracking-wide">Decision</h3>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => update("decision", "REJECT")}
                className={`h-14 rounded-lg border-2 font-semibold text-sm flex items-center justify-center gap-2 transition-colors ${
                  form.decision === "REJECT"
                    ? "bg-red-600 text-white border-red-600"
                    : "bg-background text-red-600 border-red-600/40 hover:bg-red-50 dark:hover:bg-red-950/20"
                }`}
                data-testid="button-decision-reject"
              >
                <XCircle className="w-4 h-4" />
                Reject
              </button>
              <button
                type="button"
                onClick={() => update("decision", "HIRE")}
                className={`h-14 rounded-lg border-2 font-semibold text-sm flex items-center justify-center gap-2 transition-colors ${
                  form.decision === "HIRE"
                    ? "bg-green-600 text-white border-green-600"
                    : "bg-background text-green-700 border-green-600/40 hover:bg-green-50 dark:hover:bg-green-950/20"
                }`}
                data-testid="button-decision-hire"
              >
                <ThumbsUp className="w-4 h-4" />
                Hire
              </button>
            </div>
          </CardContent>
        </Card>

        {!showSendForm && (
          <Button
            type="submit"
            size="lg"
            className="w-full h-14 text-base font-semibold"
            disabled={isPending || form.decision === "PENDING"}
            data-testid="button-submit"
          >
            {isPending && <Loader2 className="w-5 h-5 mr-2 animate-spin" />}
            {form.decision === "HIRE" ? "Save & Continue" :
             form.decision === "REJECT" ? "Save as Rejected" :
             "Select a decision"}
          </Button>
        )}

        {showSendForm && (
          <Card className="border-primary">
            <CardContent className="p-4 space-y-3">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <CheckCircle2 className="w-4 h-4 text-green-600" />
                Candidate hired — send them the onboarding form
              </div>
              <p className="text-xs text-muted-foreground break-all">{onboardingUrl}</p>
              <Button
                type="button"
                size="lg"
                className="w-full h-12"
                onClick={handleSendForm}
                data-testid="button-send-form"
              >
                {copied ? (
                  <>
                    <Check className="w-5 h-5 mr-2" />
                    Link Copied
                  </>
                ) : (
                  <>
                    <Send className="w-5 h-5 mr-2" />
                    Send Form to {form.phone || "candidate"}
                  </>
                )}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="w-full"
                onClick={handleReset}
                data-testid="button-new-interview-after-hire"
              >
                Start New Interview
              </Button>
            </CardContent>
          </Card>
        )}
      </form>
    </MobileLayout>
  );
}
