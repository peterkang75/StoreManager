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
import { Users, Search, Copy, Check, Loader2, LinkIcon } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { Candidate, InsertCandidate } from "@shared/schema";

const hireDecisionOptions = [
  { value: "PENDING", label: "대기", variant: "secondary" as const },
  { value: "HIRE", label: "채용", variant: "default" as const },
  { value: "REJECT", label: "불합격", variant: "destructive" as const },
];

function getDecisionBadge(decision: string) {
  const option = hireDecisionOptions.find(o => o.value === decision);
  return <Badge variant={option?.variant ?? "secondary"}>{option?.label ?? decision}</Badge>;
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
      toast({ title: "후보자가 성공적으로 업데이트되었습니다" });
    },
    onError: (error: Error) => {
      toast({ title: "오류", description: error.message, variant: "destructive" });
    },
  });

  const handleFieldChange = (field: keyof InsertCandidate, value: string) => {
    setFormData({ ...formData, [field]: value });
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
              <Label htmlFor="dob">Date of Birth</Label>
              <Input
                id="dob"
                type="date"
                value={currentData.dob ?? ""}
                onChange={(e) => handleFieldChange("dob", e.target.value)}
                data-testid="input-candidate-dob"
              />
            </div>
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

          <div className="space-y-2">
            <Label htmlFor="experience">Experience</Label>
            <Textarea
              id="experience"
              value={currentData.experience ?? ""}
              onChange={(e) => handleFieldChange("experience", e.target.value)}
              placeholder="Describe relevant experience..."
              data-testid="input-candidate-experience"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="availability">Availability</Label>
              <Input
                id="availability"
                value={currentData.availability ?? ""}
                onChange={(e) => handleFieldChange("availability", e.target.value)}
                placeholder="e.g., Full-time, Weekends"
                data-testid="input-candidate-availability"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="desiredRate">Desired Rate</Label>
              <Input
                id="desiredRate"
                value={currentData.desiredRate ?? ""}
                onChange={(e) => handleFieldChange("desiredRate", e.target.value)}
                placeholder="e.g., $25/hr"
                data-testid="input-candidate-rate"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="visaType">Visa Type</Label>
              <Input
                id="visaType"
                value={currentData.visaType ?? ""}
                onChange={(e) => handleFieldChange("visaType", e.target.value)}
                placeholder="e.g., Work Visa, PR"
                data-testid="input-candidate-visa-type"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="visaExpiry">Visa Expiry</Label>
              <Input
                id="visaExpiry"
                type="date"
                value={currentData.visaExpiry ?? ""}
                onChange={(e) => handleFieldChange("visaExpiry", e.target.value)}
                data-testid="input-candidate-visa-expiry"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="interviewNotes">Interview Notes</Label>
            <Textarea
              id="interviewNotes"
              value={currentData.interviewNotes ?? ""}
              onChange={(e) => handleFieldChange("interviewNotes", e.target.value)}
              placeholder="Notes from the interview..."
              className="min-h-[100px]"
              data-testid="input-candidate-notes"
            />
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
              data-testid="button-generate-link"
            >
              <LinkIcon className="w-4 h-4 mr-2" />
              Generate Onboarding Link
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
            Share this link with the candidate to complete their onboarding. The link expires in 14 days.
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
      const res = await apiRequest("POST", `/api/candidates/${id}/hire`);
      return res.json();
    },
    onSuccess: (data: { onboardingUrl: string }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/candidates"] });
      const fullUrl = `${window.location.origin}${data.onboardingUrl}`;
      setOnboardingUrl(fullUrl);
      setLinkDialogOpen(true);
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
              Review and manage candidate interviews
            </p>
          </div>
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
                    ? "Candidates will appear here after conducting interviews on mobile."
                    : "Try adjusting your search or filter criteria."}
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
