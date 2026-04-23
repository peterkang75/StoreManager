import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { AdminLayout } from "@/components/layouts/AdminLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { Users, Search, Copy, Check, Loader2, LinkIcon } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { Candidate, InsertCandidate } from "@shared/schema";
import { useAdminRole } from "@/contexts/AdminRoleContext";

const hireDecisionOptions = [
  { value: "PENDING", label: "Pending", variant: "secondary" as const },
  { value: "HIRE", label: "Hire", variant: "default" as const },
  { value: "REJECT", label: "Reject", variant: "destructive" as const },
];

function getDecisionBadge(decision: string) {
  const option = hireDecisionOptions.find(o => o.value === decision);
  return <Badge variant={option?.variant ?? "secondary"}>{option?.label ?? decision}</Badge>;
}

const AVAILABILITY_DAYS = [
  { key: "mon", label: "Mon" },
  { key: "tue", label: "Tue" },
  { key: "wed", label: "Wed" },
  { key: "thu", label: "Thu" },
  { key: "fri", label: "Fri" },
  { key: "sat", label: "Sat" },
  { key: "sun", label: "Sun" },
] as const;
const AVAILABILITY_SLOTS = [
  { value: "NONE", label: "—" },
  { value: "MORNING", label: "AM" },
  { value: "AFTERNOON", label: "PM" },
  { value: "ALLDAY", label: "All" },
] as const;

function AvailabilityGrid({
  value,
  onChange,
}: {
  value: Record<string, string>;
  onChange: (next: Record<string, string>) => void;
}) {
  return (
    <div className="space-y-1.5">
      {AVAILABILITY_DAYS.map((d) => {
        const current = value[d.key] ?? "NONE";
        return (
          <div key={d.key} className="flex items-center gap-2">
            <span className="w-10 text-xs font-medium shrink-0">{d.label}</span>
            <div className="flex gap-1 flex-1">
              {AVAILABILITY_SLOTS.map((slot) => {
                const active = current === slot.value;
                return (
                  <button
                    key={slot.value}
                    type="button"
                    onClick={() => onChange({ ...value, [d.key]: slot.value })}
                    className={`flex-1 h-7 rounded text-[11px] font-medium border transition-colors ${
                      active
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-background text-muted-foreground border-border hover:bg-muted"
                    }`}
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
  );
}

function CandidateDetailSheet({
  candidate,
  open,
  onOpenChange,
  onGenerateLink,
}: {
  candidate: Candidate | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onGenerateLink: (id: string) => void;
}) {
  const { toast } = useToast();
  const [formData, setFormData] = useState<Partial<InsertCandidate>>({});

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<InsertCandidate> }) => {
      const res = await apiRequest("PUT", `/api/candidates/${id}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/candidates"] });
      toast({ title: "Candidate updated successfully" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const handleFieldChange = (field: keyof InsertCandidate, value: unknown) => {
    setFormData({ ...formData, [field]: value as never });
  };

  const handleSave = () => {
    if (candidate) {
      updateMutation.mutate({ id: candidate.id, data: formData });
    }
  };

  if (!candidate) return null;

  const currentData = { ...candidate, ...formData };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-lg overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{candidate.name}</SheetTitle>
          <SheetDescription>
            Candidate interview details
          </SheetDescription>
        </SheetHeader>
        
        <div className="space-y-4 py-6">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="phone">Mobile</Label>
              <Input
                id="phone"
                type="tel"
                value={currentData.phone ?? ""}
                onChange={(e) => handleFieldChange("phone", e.target.value)}
                placeholder="0412 345 678"
                data-testid="input-candidate-phone"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="birthYear">Birth Year</Label>
              <Input
                id="birthYear"
                type="number"
                value={currentData.birthYear ?? ""}
                onChange={(e) => {
                  const n = parseInt(e.target.value, 10);
                  handleFieldChange("birthYear", Number.isFinite(n) ? n : null);
                }}
                placeholder="e.g., 1998"
                data-testid="input-candidate-birth-year"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="gender">Gender</Label>
              <Select
                value={currentData.gender ?? ""}
                onValueChange={(value) => handleFieldChange("gender", value)}
              >
                <SelectTrigger data-testid="select-candidate-gender">
                  <SelectValue placeholder="Select gender" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="male">Male</SelectItem>
                  <SelectItem value="female">Female</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="nationality">Nationality</Label>
              <Input
                id="nationality"
                value={currentData.nationality ?? ""}
                onChange={(e) => handleFieldChange("nationality", e.target.value)}
                data-testid="input-candidate-nationality"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="visaType">Visa Type</Label>
              <Select
                value={currentData.visaType ?? ""}
                onValueChange={(value) => handleFieldChange("visaType", value)}
              >
                <SelectTrigger data-testid="select-candidate-visa-type">
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
                value={currentData.visaExpiryMonth ?? ""}
                onChange={(e) => handleFieldChange("visaExpiryMonth", e.target.value)}
                data-testid="input-candidate-visa-expiry-month"
              />
            </div>
          </div>

          <div className="rounded-md border border-border/50 p-3 space-y-3">
            <div className="flex items-center justify-between">
              <Label className="text-sm">Has Experience</Label>
              <Switch
                checked={currentData.hasExperience ?? false}
                onCheckedChange={(v) => handleFieldChange("hasExperience", v)}
                data-testid="switch-candidate-experience"
              />
            </div>
            {(currentData.hasExperience ?? false) && (
              <Textarea
                value={currentData.experience ?? ""}
                onChange={(e) => handleFieldChange("experience", e.target.value)}
                placeholder="Experience details…"
                className="min-h-[80px]"
                data-testid="input-candidate-experience"
              />
            )}
          </div>

          <div className="rounded-md border border-border/50 p-3 space-y-3">
            <Label className="text-sm">Availability</Label>
            {currentData.availabilityDays ? (
              <AvailabilityGrid
                value={currentData.availabilityDays as Record<string, string>}
                onChange={(next) => handleFieldChange("availabilityDays", next)}
              />
            ) : (
              <Input
                value={currentData.availability ?? ""}
                onChange={(e) => handleFieldChange("availability", e.target.value)}
                placeholder="Legacy free-text availability"
                data-testid="input-candidate-availability"
              />
            )}
            <div className="space-y-1">
              <Label htmlFor="availabilityCommitment" className="text-xs text-muted-foreground">
                How long can they keep this schedule?
              </Label>
              <Input
                id="availabilityCommitment"
                value={currentData.availabilityCommitment ?? ""}
                onChange={(e) => handleFieldChange("availabilityCommitment", e.target.value)}
                placeholder="e.g., 6 months"
                data-testid="input-candidate-commitment"
              />
            </div>
          </div>

          <div className="rounded-md border border-dashed border-amber-400/60 bg-amber-50/40 dark:bg-amber-950/10 p-3 space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-400">
              Official only
            </p>
            <div className="space-y-2">
              <Label htmlFor="desiredRate">Interview Salary</Label>
              <Input
                id="desiredRate"
                value={currentData.desiredRate ?? ""}
                onChange={(e) => handleFieldChange("desiredRate", e.target.value)}
                placeholder="e.g., $25/hr"
                data-testid="input-candidate-rate"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="interviewNotes">Interviewer Memo</Label>
              <Textarea
                id="interviewNotes"
                value={currentData.interviewNotes ?? ""}
                onChange={(e) => handleFieldChange("interviewNotes", e.target.value)}
                placeholder="Impression, follow-ups…"
                className="min-h-[100px]"
                data-testid="input-candidate-notes"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="hireDecision">Hire Decision</Label>
            <Select
              value={currentData.hireDecision ?? "PENDING"}
              onValueChange={(value) => handleFieldChange("hireDecision", value)}
            >
              <SelectTrigger data-testid="select-hire-decision">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {hireDecisionOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {candidate.hireDecision === "HIRE" && (
            <Button
              variant="outline"
              className="w-full"
              onClick={() => onGenerateLink(candidate.id)}
              disabled={!candidate.phone}
              data-testid="button-generate-link"
            >
              <LinkIcon className="w-4 h-4 mr-2" />
              {candidate.phone ? "Send Onboarding SMS" : "Add a phone number to send SMS"}
            </Button>
          )}
        </div>

        <SheetFooter>
          <Button
            onClick={handleSave}
            disabled={updateMutation.isPending}
            data-testid="button-save-candidate"
          >
            {updateMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            Save Changes
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

function OnboardingLinkDialog({
  open,
  onOpenChange,
  onboardingUrl,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onboardingUrl: string;
}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(onboardingUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Onboarding Link Generated</DialogTitle>
          <DialogDescription>
            이 링크를 후보자에게 공유하여 온보딩을 완료하세요. 링크는 14일 후 만료됩니다.
          </DialogDescription>
        </DialogHeader>
        <div className="flex items-center gap-2">
          <Input 
            value={onboardingUrl} 
            readOnly 
            className="font-mono text-sm"
            data-testid="input-onboarding-url"
          />
          <Button
            variant="outline"
            size="icon"
            onClick={handleCopy}
            data-testid="button-copy-link"
          >
            {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
          </Button>
        </div>
        <DialogFooter>
          <Button onClick={() => onOpenChange(false)} data-testid="button-close-dialog">
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function AdminCandidates() {
  const { currentRole } = useAdminRole();
  const isManager = currentRole === "MANAGER";
  const { toast } = useToast();
  const [searchTerm, setSearchTerm] = useState("");
  const [decisionFilter, setDecisionFilter] = useState<string>("all");
  const [selectedCandidate, setSelectedCandidate] = useState<Candidate | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [linkDialogOpen, setLinkDialogOpen] = useState(false);
  const [onboardingUrl, setOnboardingUrl] = useState("");

  const { data: candidates, isLoading } = useQuery<Candidate[]>({
    queryKey: ["/api/candidates"],
  });

  const hireMutation = useMutation({
    mutationFn: async (id: string) => {
      // Single-shot Send Form: ensures HIRE + active token + SMS attempt in one call.
      const res = await apiRequest("POST", `/api/candidates/${id}/send-form-sms`);
      return res.json() as Promise<{ ok: boolean; url: string; error?: string }>;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/candidates"] });
      setOnboardingUrl(data.url);
      if (data.ok) {
        toast({ title: "SMS sent", description: "Onboarding link delivered to the candidate." });
      } else {
        setLinkDialogOpen(true);
        toast({
          title: "SMS unavailable — use the manual link",
          description: data.error ?? "Share the link in the dialog.",
          variant: "destructive",
        });
      }
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const filteredCandidates = candidates?.filter((c) => {
    const matchesSearch = c.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      c.nationality?.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesDecision = decisionFilter === "all" || c.hireDecision === decisionFilter;
    return matchesSearch && matchesDecision;
  });

  const handleRowClick = (candidate: Candidate) => {
    setSelectedCandidate(candidate);
    setDetailOpen(true);
  };

  const handleGenerateLink = (id: string) => {
    hireMutation.mutate(id);
  };

  const formatDate = (dateString: string | Date) => {
    return new Date(dateString).toLocaleDateString();
  };

  return (
    <AdminLayout title="Candidate Management">
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <h2 className="text-xl font-semibold">Candidates</h2>
            <p className="text-sm text-muted-foreground">
              {isManager
                ? "Review and manage candidate interviews."
                : "후보자 면접을 검토하고 관리합니다"}
            </p>
          </div>
          <Button asChild data-testid="button-start-interview">
            <a href="/m/interview" target="_blank" rel="noopener noreferrer">
              <Users className="w-4 h-4 mr-2" />
              Start New Interview
            </a>
          </Button>
        </div>

        <div className="flex flex-col sm:flex-row gap-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by name or nationality..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10"
              data-testid="input-search-candidates"
            />
          </div>
          <Select value={decisionFilter} onValueChange={setDecisionFilter}>
            <SelectTrigger className="w-full sm:w-[180px]" data-testid="select-decision-filter">
              <SelectValue placeholder="Filter by decision" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Decisions</SelectItem>
              {hireDecisionOptions.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <Card>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="p-6 space-y-3">
                {[...Array(5)].map((_, i) => (
                  <Skeleton key={i} className="h-12 w-full" />
                ))}
              </div>
            ) : filteredCandidates?.length === 0 ? (
              <div className="p-12 text-center">
                <Users className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
                <h3 className="text-lg font-medium mb-2">No candidates found</h3>
                <p className="text-sm text-muted-foreground">
                  {candidates?.length === 0
                    ? isManager
                      ? "Candidates will appear here once interviews are completed on mobile."
                      : "모바일에서 면접을 진행하면 후보자가 여기에 표시됩니다."
                    : isManager
                      ? "Try adjusting the search term or filter."
                      : "검색어 또는 필터 조건을 조정해 보세요."}
                </p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Nationality</TableHead>
                    <TableHead>Availability</TableHead>
                    <TableHead>Desired Rate</TableHead>
                    <TableHead>Decision</TableHead>
                    <TableHead>Interview Date</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredCandidates?.map((candidate) => (
                    <TableRow
                      key={candidate.id}
                      className="cursor-pointer"
                      onClick={() => handleRowClick(candidate)}
                      data-testid={`row-candidate-${candidate.id}`}
                    >
                      <TableCell className="font-medium">{candidate.name}</TableCell>
                      <TableCell>{candidate.nationality || "—"}</TableCell>
                      <TableCell>{candidate.availability || "—"}</TableCell>
                      <TableCell>{candidate.desiredRate || "—"}</TableCell>
                      <TableCell>{getDecisionBadge(candidate.hireDecision)}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {formatDate(candidate.createdAt)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <CandidateDetailSheet
          candidate={selectedCandidate}
          open={detailOpen}
          onOpenChange={setDetailOpen}
          onGenerateLink={handleGenerateLink}
        />

        <OnboardingLinkDialog
          open={linkDialogOpen}
          onOpenChange={setLinkDialogOpen}
          onboardingUrl={onboardingUrl}
        />
      </div>
    </AdminLayout>
  );
}
