import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { MobileLayout } from "@/components/layouts/MobileLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CheckCircle2, Loader2, ClipboardCheck } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { InsertCandidate } from "@shared/schema";

function SuccessScreen({ onReset }: { onReset: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] text-center px-4">
      <div className="w-20 h-20 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center mb-6">
        <CheckCircle2 className="w-10 h-10 text-green-600 dark:text-green-400" />
      </div>
      <h2 className="text-2xl font-bold mb-2" data-testid="text-success-title">
        Interview Saved
      </h2>
      <p className="text-muted-foreground mb-8 max-w-sm">
        The candidate interview has been recorded successfully. You can now continue with the next candidate.
      </p>
      <Button 
        size="lg" 
        className="w-full max-w-xs h-14 text-base"
        onClick={onReset}
        data-testid="button-new-interview"
      >
        <ClipboardCheck className="w-5 h-5 mr-2" />
        New Interview
      </Button>
    </div>
  );
}

export function MobileInterview() {
  const { toast } = useToast();
  const [showSuccess, setShowSuccess] = useState(false);
  const [formData, setFormData] = useState<InsertCandidate>({
    name: "",
    dob: "",
    gender: "",
    nationality: "",
    experience: "",
    availability: "",
    desiredRate: "",
    visaType: "",
    visaExpiry: "",
    interviewNotes: "",
    hireDecision: "PENDING",
  });

  const createMutation = useMutation({
    mutationFn: async (data: InsertCandidate) => {
      const res = await apiRequest("POST", "/api/candidates", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/candidates"] });
      setShowSuccess(true);
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name.trim()) {
      toast({ title: "Error", description: "Candidate name is required", variant: "destructive" });
      return;
    }
    createMutation.mutate(formData);
  };

  const handleReset = () => {
    setFormData({
      name: "",
      dob: "",
      gender: "",
      nationality: "",
      experience: "",
      availability: "",
      desiredRate: "",
      visaType: "",
      visaExpiry: "",
      interviewNotes: "",
      hireDecision: "PENDING",
    });
    setShowSuccess(false);
  };

  const handleChange = (field: keyof InsertCandidate, value: string) => {
    setFormData({ ...formData, [field]: value });
  };

  if (showSuccess) {
    return (
      <MobileLayout title="Interview" showHeader={false}>
        <SuccessScreen onReset={handleReset} />
      </MobileLayout>
    );
  }

  return (
    <MobileLayout title="Candidate Interview">
      <form onSubmit={handleSubmit} className="space-y-6 pb-8">
        <Card>
          <CardContent className="p-4 space-y-4">
            <h3 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide">
              Basic Information
            </h3>
            
            <div className="space-y-2">
              <Label htmlFor="name">Full Name *</Label>
              <Input
                id="name"
                value={formData.name}
                onChange={(e) => handleChange("name", e.target.value)}
                placeholder="Enter candidate's full name"
                className="h-12 text-base"
                required
                data-testid="input-name"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="dob">Date of Birth</Label>
                <Input
                  id="dob"
                  type="date"
                  value={formData.dob ?? ""}
                  onChange={(e) => handleChange("dob", e.target.value)}
                  className="h-12 text-base"
                  data-testid="input-dob"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="gender">Gender</Label>
                <Select
                  value={formData.gender ?? ""}
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
              <Label htmlFor="nationality">Nationality</Label>
              <Input
                id="nationality"
                value={formData.nationality ?? ""}
                onChange={(e) => handleChange("nationality", e.target.value)}
                placeholder="e.g., Australian, Thai"
                className="h-12 text-base"
                data-testid="input-nationality"
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4 space-y-4">
            <h3 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide">
              Work Details
            </h3>

            <div className="space-y-2">
              <Label htmlFor="experience">Experience</Label>
              <Textarea
                id="experience"
                value={formData.experience ?? ""}
                onChange={(e) => handleChange("experience", e.target.value)}
                placeholder="Describe relevant work experience..."
                className="min-h-[100px] text-base"
                data-testid="input-experience"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="availability">Availability</Label>
                <Input
                  id="availability"
                  value={formData.availability ?? ""}
                  onChange={(e) => handleChange("availability", e.target.value)}
                  placeholder="e.g., Weekends"
                  className="h-12 text-base"
                  data-testid="input-availability"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="desiredRate">Desired Rate</Label>
                <Input
                  id="desiredRate"
                  value={formData.desiredRate ?? ""}
                  onChange={(e) => handleChange("desiredRate", e.target.value)}
                  placeholder="e.g., $25/hr"
                  className="h-12 text-base"
                  data-testid="input-rate"
                />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4 space-y-4">
            <h3 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide">
              Visa Information
            </h3>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="visaType">Visa Type</Label>
                <Select
                  value={formData.visaType ?? ""}
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
                  value={formData.visaExpiry ?? ""}
                  onChange={(e) => handleChange("visaExpiry", e.target.value)}
                  className="h-12 text-base"
                  data-testid="input-visa-expiry"
                />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4 space-y-4">
            <h3 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide">
              Interview Notes
            </h3>

            <div className="space-y-2">
              <Textarea
                id="interviewNotes"
                value={formData.interviewNotes ?? ""}
                onChange={(e) => handleChange("interviewNotes", e.target.value)}
                placeholder="Enter notes from the interview..."
                className="min-h-[150px] text-base"
                data-testid="input-notes"
              />
            </div>
          </CardContent>
        </Card>

        <Button
          type="submit"
          size="lg"
          className="w-full h-14 text-base font-semibold"
          disabled={createMutation.isPending}
          data-testid="button-submit"
        >
          {createMutation.isPending && <Loader2 className="w-5 h-5 mr-2 animate-spin" />}
          Submit Interview
        </Button>
      </form>
    </MobileLayout>
  );
}
