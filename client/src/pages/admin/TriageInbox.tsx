import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { AdminLayout } from "@/components/layouts/AdminLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  CreditCard,
  CheckSquare,
  Archive,
  Trash2,
  Paperclip,
  Mail,
  MailOpen,
  Clock,
  RefreshCw,
  AlertTriangle,
  Eye,
  User,
  Calendar,
  Sparkles,
  Loader2,
  FileText,
  Languages,
} from "lucide-react";
import type { UniversalInboxItem } from "@shared/schema";

type RouteAction = "ROUTE_TO_AP" | "ROUTE_TO_TODO" | "FYI_ARCHIVE" | "SPAM_DROP";

// API enriches items with suggestedAction from stored routing rule
type TriageItem = UniversalInboxItem & { suggestedAction?: RouteAction | null };

// Strip Google Groups "via GroupName" suffix from display names
// "'Natalie Brown' via Accounts" → "Natalie Brown"
function cleanSenderName(name: string | null | undefined): string | null {
  if (!name) return null;
  const cleaned = name
    .replace(/\s+via\s+.*/i, "")
    .replace(/^["']+|["']+$/g, "")
    .trim();
  return cleaned || null;
}

interface ActionConfig {
  label: string;
  description: string;
  confirmLabel: string;
  icon: typeof CreditCard;
  variant: "default" | "outline" | "secondary" | "destructive";
}

const ACTION_CONFIG: Record<RouteAction, ActionConfig> = {
  ROUTE_TO_AP: {
    label: "Payables",
    description: "이 발신자의 이메일을 '매입 채무(Accounts Payable)' 파이프라인으로 라우팅합니다. 앞으로 이 발신자에게서 받는 이메일은 자동으로 청구서로 처리됩니다.",
    confirmLabel: "Send to Payables",
    icon: CreditCard,
    variant: "default",
  },
  ROUTE_TO_TODO: {
    label: "To-Do",
    description: "이 발신자의 이메일을 '할 일(Smart Inbox)' 파이프라인으로 라우팅합니다. 앞으로 이 발신자에게서 받는 이메일은 자동으로 실행 항목으로 처리됩니다.",
    confirmLabel: "Send to To-Do",
    icon: CheckSquare,
    variant: "secondary",
  },
  FYI_ARCHIVE: {
    label: "FYI",
    description: "이 발신자의 이메일을 참조용으로만 처리합니다. 앞으로 이 발신자에게서 받는 이메일은 조용히 수락하고 별도의 처리 없이 보관됩니다.",
    confirmLabel: "Mark as FYI",
    icon: Archive,
    variant: "outline",
  },
  SPAM_DROP: {
    label: "Spam",
    description: "이 발신자의 이메일을 스팸으로 처리합니다. 앞으로 이 발신자에게서 받는 이메일은 자동으로 무시됩니다.",
    confirmLabel: "Mark as Spam",
    icon: Trash2,
    variant: "destructive",
  },
};

function formatRelativeTime(date: Date | string): string {
  const d = new Date(date);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);
  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  return `${diffDays}d ago`;
}

function formatFullDate(date: Date | string): string {
  return new Date(date).toLocaleString("en-AU", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

interface ConfirmDialog {
  itemId: string;
  action: RouteAction;
  senderEmail: string;
}

type SpamMatchType = "EXACT" | "DOMAIN";

function extractDomain(addr: string): string {
  const atIdx = addr.lastIndexOf("@");
  return atIdx >= 0 ? addr.slice(atIdx + 1) : addr;
}

const SUGGESTED_ACTION_LABEL: Record<RouteAction, string> = {
  ROUTE_TO_AP: "Payables",
  ROUTE_TO_TODO: "To-Do",
  FYI_ARCHIVE: "FYI",
  SPAM_DROP: "Spam",
};

// ── AI result type ─────────────────────────────────────────────────────────────

interface AiResult {
  summary: string;
  translation: string;
}

// ── Full Email View Dialog ─────────────────────────────────────────────────────

function EmailViewDialog({
  item,
  onClose,
  onAction,
  isPending,
}: {
  item: TriageItem | null;
  onClose: () => void;
  onAction: (id: string, action: RouteAction) => void;
  isPending: boolean;
}) {
  const [aiResult, setAiResult] = useState<AiResult | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [showTranslation, setShowTranslation] = useState(false);

  // Reset AI state when a different email is opened
  useEffect(() => {
    setAiResult(null);
    setAiError(null);
    setAiLoading(false);
    setShowTranslation(false);
  }, [item?.id]);

  if (!item) return null;

  const isProcessed = item.status !== "NEEDS_ROUTING";
  const suggested = item.suggestedAction as RouteAction | null | undefined;

  async function handleAiTranslate() {
    setAiLoading(true);
    setAiError(null);
    setAiResult(null);
    try {
      const res = await fetch("/api/ai/email-translate-summarize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subject: item!.subject, body: item!.body }),
      });
      if (!res.ok) throw new Error("서버 오류");
      const data = await res.json() as AiResult;
      setAiResult(data);
      setShowTranslation(false);
    } catch {
      setAiError("AI 분석 중 오류가 발생했습니다. 다시 시도해 주세요.");
    } finally {
      setAiLoading(false);
    }
  }

  return (
    <Dialog open={!!item} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-2xl w-full p-0 gap-0 overflow-hidden" aria-describedby={undefined}>
        <DialogHeader className="px-6 pt-6 pb-4 border-b">
          <div className="flex items-start justify-between gap-3">
            <DialogTitle
              className="text-base font-bold leading-snug"
              data-testid="text-email-dialog-subject"
            >
              {item.subject}
            </DialogTitle>
            {/* AI button in header top-right */}
            <Button
              size="sm"
              variant="outline"
              onClick={handleAiTranslate}
              disabled={aiLoading}
              data-testid="button-ai-translate"
              className="shrink-0 gap-1.5"
            >
              {aiLoading ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Sparkles className="w-3.5 h-3.5" />
              )}
              {aiLoading ? "분석 중…" : "한국어 번역 & 요약"}
            </Button>
          </div>

          {/* Sender + Date meta row */}
          <div className="flex flex-col gap-1.5 mt-3">
            <div className="flex items-center gap-2 text-sm flex-wrap">
              <User className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
              <span className="font-medium" data-testid="text-email-dialog-sender">
                {cleanSenderName(item.senderName) ?? item.senderEmail}
              </span>
              {item.senderName && (
                <span className="text-muted-foreground text-xs">
                  &lt;{item.senderEmail}&gt;
                </span>
              )}
              {item.hasAttachment && (
                <Badge variant="outline" className="gap-1 text-xs shrink-0">
                  <Paperclip className="w-3 h-3" />
                  Attachment
                </Badge>
              )}
            </div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Calendar className="w-3.5 h-3.5 shrink-0" />
              <span data-testid="text-email-dialog-date">
                {formatFullDate(item.createdAt)}
              </span>
            </div>
          </div>
        </DialogHeader>

        {/* Scrollable content area: AI result + original body */}
        <div className="max-h-[45vh] overflow-y-auto" data-testid="text-email-dialog-body">

          {/* AI error */}
          {aiError && (
            <div className="mx-6 mt-4 px-4 py-3 rounded-md bg-destructive/10 text-destructive text-sm">
              {aiError}
            </div>
          )}

          {/* AI result panel */}
          {aiResult && (
            <div className="mx-6 mt-4 rounded-md border bg-muted/40 overflow-hidden" data-testid="panel-ai-result">
              {/* Summary section */}
              <div className="px-4 py-3 border-b">
                <div className="flex items-center gap-1.5 mb-2">
                  <FileText className="w-3.5 h-3.5 text-primary" />
                  <span className="text-xs font-semibold text-primary uppercase tracking-wide">요약</span>
                </div>
                <pre
                  className="text-sm text-foreground whitespace-pre-wrap font-sans leading-relaxed break-words"
                  data-testid="text-ai-summary"
                >
                  {aiResult.summary}
                </pre>
              </div>

              {/* Translation section (toggle) */}
              <div className="px-4 py-2">
                <button
                  type="button"
                  className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors w-full py-1"
                  onClick={() => setShowTranslation(v => !v)}
                  data-testid="button-toggle-translation"
                >
                  <Languages className="w-3.5 h-3.5 shrink-0" />
                  <span className="font-medium">한국어 번역</span>
                  <span className="ml-auto text-xs">{showTranslation ? "접기 ▲" : "펼치기 ▼"}</span>
                </button>
                {showTranslation && (
                  <pre
                    className="mt-2 pb-2 text-sm text-foreground whitespace-pre-wrap font-sans leading-relaxed break-words border-t pt-2"
                    data-testid="text-ai-translation"
                  >
                    {aiResult.translation}
                  </pre>
                )}
              </div>
            </div>
          )}

          {/* Original email body */}
          <div className="px-6 py-5">
            {item.body ? (
              <>
                {aiResult && (
                  <p className="text-xs text-muted-foreground mb-2 font-medium">— 원문 —</p>
                )}
                <pre className="text-sm text-foreground whitespace-pre-wrap font-sans leading-relaxed break-words">
                  {item.body}
                </pre>
              </>
            ) : (
              <p className="text-sm text-muted-foreground italic">No content.</p>
            )}
          </div>
        </div>

        {/* Footer: routing buttons (unprocessed) or close only (processed) */}
        <div className="px-6 py-4 border-t flex items-center gap-2 flex-wrap justify-between">
          {!isProcessed ? (
            <>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs text-muted-foreground font-medium shrink-0">
                  Route this sender:
                </span>
                {(Object.keys(ACTION_CONFIG) as RouteAction[]).map((action) => {
                  const cfg = ACTION_CONFIG[action];
                  const Icon = cfg.icon;
                  const isSuggested = action === suggested;
                  return (
                    <Button
                      key={action}
                      size="sm"
                      variant={isSuggested ? "default" : cfg.variant}
                      disabled={isPending}
                      onClick={() => onAction(item.id, action)}
                      data-testid={`button-dialog-${action.toLowerCase()}-${item.id}`}
                      className={`gap-1.5 ${isSuggested ? "ring-2 ring-offset-1 ring-primary" : ""}`}
                    >
                      <Icon className="w-3.5 h-3.5" />
                      {cfg.label}
                      {isSuggested && <span className="text-xs opacity-75">(추천)</span>}
                    </Button>
                  );
                })}
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={onClose}
                data-testid="button-email-dialog-close"
              >
                Cancel
              </Button>
            </>
          ) : (
            <div className="ml-auto">
              <Button
                variant="outline"
                onClick={onClose}
                data-testid="button-email-dialog-close"
              >
                Close
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Inbox Item Card ────────────────────────────────────────────────────────────

function InboxItemCard({
  item,
  onAction,
  onView,
  isPending,
}: {
  item: TriageItem;
  onAction: (id: string, action: RouteAction) => void;
  onView: (item: TriageItem) => void;
  isPending: boolean;
}) {
  const isProcessed = item.status !== "NEEDS_ROUTING";
  const bodyPreview = item.body.slice(0, 200).trim();
  const suggested = item.suggestedAction as RouteAction | null | undefined;

  return (
    <Card
      data-testid={`card-triage-${item.id}`}
      className={isProcessed ? "opacity-60" : ""}
    >
      <CardHeader className="pb-2 flex flex-row items-start justify-between gap-3 flex-wrap">
        <div className="flex flex-col gap-1 min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            {isProcessed ? (
              <MailOpen className="w-4 h-4 text-muted-foreground shrink-0" />
            ) : (
              <Mail className="w-4 h-4 text-foreground shrink-0" />
            )}
            <span
              className="font-medium text-sm truncate"
              data-testid={`text-sender-${item.id}`}
            >
              {cleanSenderName(item.senderName) ?? item.senderEmail}
            </span>
            <span className="text-xs text-muted-foreground truncate hidden sm:inline">
              &lt;{item.senderEmail}&gt;
            </span>
            {item.hasAttachment && (
              <Badge variant="outline" className="gap-1 text-xs shrink-0">
                <Paperclip className="w-3 h-3" />
                Attachment
              </Badge>
            )}
            {suggested && !isProcessed && (
              <Badge
                variant="secondary"
                className="text-xs shrink-0 bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300"
                data-testid={`badge-suggested-${item.id}`}
              >
                기존 규칙: {SUGGESTED_ACTION_LABEL[suggested]}
              </Badge>
            )}
            {item.status === "PROCESSED" && (
              <Badge variant="secondary" className="text-xs shrink-0">Processed</Badge>
            )}
            {item.status === "DROPPED" && (
              <Badge variant="outline" className="text-xs shrink-0 text-muted-foreground">Dropped</Badge>
            )}
          </div>
          <p
            className="text-sm font-semibold text-foreground leading-tight"
            data-testid={`text-subject-${item.id}`}
          >
            {item.subject}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <Clock className="w-3 h-3" />
            <span data-testid={`text-time-${item.id}`}>
              {formatRelativeTime(item.createdAt)}
            </span>
          </div>
          <Button
            size="icon"
            variant="ghost"
            onClick={() => onView(item)}
            data-testid={`button-view-email-${item.id}`}
            title="View full email"
          >
            <Eye className="w-4 h-4" />
          </Button>
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        {bodyPreview && (
          <button
            type="button"
            className="w-full text-left group"
            onClick={() => onView(item)}
            data-testid={`button-preview-${item.id}`}
          >
            <p className="text-sm text-muted-foreground line-clamp-2 leading-relaxed group-hover:text-foreground transition-colors">
              {bodyPreview}
              {item.body.length > 200 && (
                <span className="ml-1 text-xs text-primary font-medium whitespace-nowrap">
                  … View full email
                </span>
              )}
            </p>
          </button>
        )}

        {!isProcessed && (
          <>
            <Separator />
            {suggested && (
              <p className="text-xs text-amber-700 dark:text-amber-400">
                이 발신자에 대한 기존 규칙이 있습니다. 아래에서 확인하거나 다른 액션을 선택하세요.
              </p>
            )}
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs text-muted-foreground font-medium">Route this sender:</span>
              {(Object.keys(ACTION_CONFIG) as RouteAction[]).map((action) => {
                const cfg = ACTION_CONFIG[action];
                const Icon = cfg.icon;
                const isSuggested = action === suggested;
                return (
                  <Button
                    key={action}
                    size="sm"
                    variant={isSuggested ? "default" : cfg.variant}
                    disabled={isPending}
                    onClick={() => onAction(item.id, action)}
                    data-testid={`button-${action.toLowerCase()}-${item.id}`}
                    className={`gap-1.5 ${isSuggested ? "ring-2 ring-offset-1 ring-primary" : ""}`}
                  >
                    <Icon className="w-3.5 h-3.5" />
                    {cfg.label}
                    {isSuggested && <span className="text-xs opacity-75">(추천)</span>}
                  </Button>
                );
              })}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export function AdminTriageInbox() {
  const { toast } = useToast();
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialog | null>(null);
  const [spamMatch, setSpamMatch] = useState<SpamMatchType>("DOMAIN");
  const [viewItem, setViewItem] = useState<TriageItem | null>(null);
  const [activeTab, setActiveTab] = useState("needs-routing");

  const { data: allItems = [], isLoading, refetch } = useQuery<TriageItem[]>({
    queryKey: ["/api/universal-inbox"],
  });

  const applyRulesMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/universal-inbox/apply-rules", {});
      return res.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/universal-inbox"] });
      queryClient.invalidateQueries({ queryKey: ["/api/supplier-invoices"] });
      queryClient.invalidateQueries({ queryKey: ["/api/invoices/review"] });
      queryClient.invalidateQueries({ queryKey: ["/api/invoices"] });
      queryClient.invalidateQueries({ queryKey: ["/api/todos"] });
      const parts = [];
      if (data?.supplierMatched) parts.push(`${data.supplierMatched} matched supplier`);
      if (data?.apReview && data.apReview > (data.supplierMatched ?? 0)) parts.push(`${data.apReview - (data.supplierMatched ?? 0)} routed to Payables`);
      if (data?.todoCreated) parts.push(`${data.todoCreated} TODOs`);
      if (data?.spamDropped) parts.push(`${data.spamDropped} spam dropped`);
      if (data?.fyiDropped) parts.push(`${data.fyiDropped} FYI dropped`);
      const moved = (data?.supplierMatched ?? 0) + ((data?.apReview ?? 0) - (data?.supplierMatched ?? 0)) + (data?.todoCreated ?? 0) + (data?.spamDropped ?? 0) + (data?.fyiDropped ?? 0);
      toast({
        title: moved > 0 ? "Rules applied" : "No matching rules",
        description: moved > 0
          ? parts.join(" · ")
          : `${data?.total ?? 0} item(s) checked. None matched a supplier or rule.`,
      });
    },
    onError: () => {
      toast({ title: "Failed to apply rules", variant: "destructive" });
    },
  });

  const routeMutation = useMutation({
    mutationFn: async ({ id, action, matchType }: { id: string; action: RouteAction; matchType?: SpamMatchType }) => {
      const body: any = { action };
      if (matchType) body.matchType = matchType;
      const res = await apiRequest("POST", `/api/universal-inbox/${id}/route`, body);
      return res.json();
    },
    onSuccess: (data: any, { action }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/universal-inbox"] });
      queryClient.invalidateQueries({ queryKey: ["/api/todos"] });
      queryClient.invalidateQueries({ queryKey: ["/api/supplier-invoices"] });
      queryClient.invalidateQueries({ queryKey: ["/api/invoices/review"] });
      queryClient.invalidateQueries({ queryKey: ["/api/invoices"] });
      const cfg = ACTION_CONFIG[action];
      const bulkDropped: number = data?.bulkDropped ?? 0;
      const bulkApplied: number = data?.bulkApplied ?? 0;
      const otherCount = bulkDropped + bulkApplied;
      const suffix = otherCount > 0
        ? ` ${otherCount} other email${otherCount === 1 ? "" : "s"} from this sender ${otherCount === 1 ? "was" : "were"} processed too.`
        : "";
      let description: string;
      if (action === "ROUTE_TO_AP") {
        description = `Sent to Payables.${suffix} Future emails will be handled automatically.`;
      } else if (action === "SPAM_DROP") {
        description = `Marked as spam.${suffix} Future emails from this sender will be blocked automatically.`;
      } else if (action === "FYI_ARCHIVE") {
        description = `Archived as FYI.${suffix} Future emails from this sender will be archived automatically.`;
      } else if (action === "ROUTE_TO_TODO") {
        description = `Sent to To-Do.${suffix} Future emails will be summarised into TODOs automatically.`;
      } else {
        description = `Sender routed to "${cfg.label}".${suffix}`;
      }
      toast({ title: "Routing rule saved", description });
    },
    onError: () => {
      toast({
        title: "Failed to route",
        description: "An error occurred while saving the routing rule.",
        variant: "destructive",
      });
    },
  });

  const needsRouting = allItems.filter(i => i.status === "NEEDS_ROUTING");
  const processed = allItems.filter(i => i.status === "PROCESSED");
  const dropped = allItems.filter(i => i.status === "DROPPED");

  // Re-derive true sender email in case the old parser stored a group alias.
  // Pattern A: senderName = "'accounts@maru-food.com' via Accounts" → email before "via"
  // Pattern B: senderName = "'Natalie Brown' via Accounts" → NAME before "via" → can't extract email
  function resolveTrueSenderEmail(item: TriageItem): string {
    const EMAIL_VIA = /^["']?([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})["']?\s+via\s+/i;
    if (item.senderName) {
      const m = item.senderName.match(EMAIL_VIA);
      if (m) return m[1].toLowerCase();
    }
    // Pattern B: can't extract email from name — fall back to stored senderEmail
    // (routing API will try to fix via Reply-To at route time)
    return item.senderEmail;
  }

  function handleActionClick(id: string, action: RouteAction) {
    const item = allItems.find(i => i.id === id);
    if (!item) return;
    setSpamMatch("DOMAIN"); // default to aggressive when opening spam dialog
    setConfirmDialog({ itemId: id, action, senderEmail: resolveTrueSenderEmail(item) });
  }

  function handleConfirm() {
    if (!confirmDialog) return;
    const matchType = confirmDialog.action === "SPAM_DROP" ? spamMatch : undefined;
    routeMutation.mutate({ id: confirmDialog.itemId, action: confirmDialog.action, matchType });
    setConfirmDialog(null);
  }

  const renderList = (items: UniversalInboxItem[]) => {
    if (isLoading) {
      return (
        <div className="flex items-center justify-center py-16 text-muted-foreground gap-2">
          <RefreshCw className="w-4 h-4 animate-spin" />
          <span>Loading…</span>
        </div>
      );
    }
    if (items.length === 0) {
      return (
        <div
          className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-2"
          data-testid="text-empty-inbox"
        >
          <Mail className="w-8 h-8 opacity-40" />
          <p className="text-sm">No items here.</p>
        </div>
      );
    }
    return (
      <div className="space-y-3">
        {items.map(item => (
          <InboxItemCard
            key={item.id}
            item={item}
            onAction={handleActionClick}
            onView={setViewItem}
            isPending={routeMutation.isPending}
          />
        ))}
      </div>
    );
  };

  return (
    <AdminLayout title="Triage Inbox">
      <div className="space-y-4">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-xl font-bold" data-testid="text-page-title">Triage Inbox</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              라우팅 규칙이 없는 발신자에게서 받은 이메일을 검토하고 라우팅 규칙을 설정합니다.
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {needsRouting.length > 0 && (
              <div className="flex items-center gap-1.5 text-sm text-amber-600 dark:text-amber-400">
                <AlertTriangle className="w-4 h-4" />
                <span>{needsRouting.length} item{needsRouting.length !== 1 ? "s" : ""} need routing</span>
              </div>
            )}
            <Button
              size="sm"
              variant="outline"
              onClick={() => applyRulesMutation.mutate()}
              disabled={applyRulesMutation.isPending || needsRouting.length === 0}
              data-testid="button-apply-rules"
              title="Re-check every pending item against the supplier directory and saved rules"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${applyRulesMutation.isPending ? "animate-spin" : ""}`} />
              Apply Rules
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => refetch()}
              disabled={isLoading}
              data-testid="button-refresh"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? "animate-spin" : ""}`} />
              Refresh
            </Button>
          </div>
        </div>

        <div className="rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground space-y-1">
          <p className="font-medium text-foreground text-sm">어떻게 작동합니까?</p>
          <p>알 수 없는 발신자로부터 이메일이 수신되면 이 Triage Inbox에 저장됩니다. 각 발신자에 대한 라우팅 규칙을 설정하면 향후 해당 발신자의 이메일은 자동으로 처리됩니다.</p>
          <ul className="mt-1 space-y-0.5 list-none">
            <li><span className="font-medium text-foreground">Payables</span> — 청구서 발신자: 인보이스 파이프라인으로 자동 처리</li>
            <li><span className="font-medium text-foreground">To-Do</span> — 업무 요청 발신자: Smart Inbox 할 일로 자동 처리</li>
            <li><span className="font-medium text-foreground">FYI</span> — 정보성 발신자: 조용히 수락만 하고 별도 처리 없음</li>
            <li><span className="font-medium text-foreground">Spam</span> — 스팸/구독: 자동으로 무시</li>
          </ul>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab} data-testid="tabs-triage">
          <TabsList>
            <TabsTrigger value="needs-routing" data-testid="tab-needs-routing">
              Needs Routing
              {needsRouting.length > 0 && (
                <Badge variant="destructive" className="ml-1.5 text-xs">
                  {needsRouting.length}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="processed" data-testid="tab-processed">
              Processed
              {processed.length > 0 && (
                <Badge variant="secondary" className="ml-1.5 text-xs">
                  {processed.length}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="dropped" data-testid="tab-dropped">
              Dropped
              {dropped.length > 0 && (
                <Badge variant="outline" className="ml-1.5 text-xs">
                  {dropped.length}
                </Badge>
              )}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="needs-routing" className="mt-4">
            {renderList(needsRouting)}
          </TabsContent>
          <TabsContent value="processed" className="mt-4">
            {renderList(processed)}
          </TabsContent>
          <TabsContent value="dropped" className="mt-4">
            {renderList(dropped)}
          </TabsContent>
        </Tabs>
      </div>

      {/* Full Email View Dialog */}
      <EmailViewDialog
        item={viewItem}
        onClose={() => setViewItem(null)}
        onAction={(id, action) => {
          setViewItem(null);
          handleActionClick(id, action);
        }}
        isPending={routeMutation.isPending}
      />

      {/* Route Confirm Dialog */}
      {confirmDialog && (
        <AlertDialog open={true} onOpenChange={() => setConfirmDialog(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Confirm Routing Rule</AlertDialogTitle>
              <AlertDialogDescription asChild>
                <div className="space-y-3">
                  <p>
                    Set routing rule for <strong>{confirmDialog.senderEmail}</strong>:
                  </p>
                  <p className="text-sm">
                    {ACTION_CONFIG[confirmDialog.action].description}
                  </p>
                  {confirmDialog.action === "SPAM_DROP" && (
                    <div className="rounded-md border border-border p-3 space-y-2">
                      <p className="text-xs font-semibold text-foreground">
                        어떤 범위까지 스팸으로 처리할까요?
                      </p>
                      <label className="flex items-start gap-2 cursor-pointer text-sm">
                        <input
                          type="radio"
                          name="spam-match"
                          value="DOMAIN"
                          checked={spamMatch === "DOMAIN"}
                          onChange={() => setSpamMatch("DOMAIN")}
                          className="mt-0.5"
                          data-testid="radio-spam-domain"
                        />
                        <span>
                          <span className="font-medium">도메인 전체</span>{" "}
                          <span className="font-mono text-xs text-muted-foreground">
                            {extractDomain(confirmDialog.senderEmail)}
                          </span>
                          <span className="block text-xs text-muted-foreground mt-0.5">
                            같은 도메인에서 오는 모든 주소 (발송주소가 매번 바뀌는 광고에 추천)
                          </span>
                        </span>
                      </label>
                      <label className="flex items-start gap-2 cursor-pointer text-sm">
                        <input
                          type="radio"
                          name="spam-match"
                          value="EXACT"
                          checked={spamMatch === "EXACT"}
                          onChange={() => setSpamMatch("EXACT")}
                          className="mt-0.5"
                          data-testid="radio-spam-exact"
                        />
                        <span>
                          <span className="font-medium">이 주소만</span>
                          <span className="block text-xs text-muted-foreground mt-0.5">
                            정확히 이 발송주소에서 오는 메일만
                          </span>
                        </span>
                      </label>
                    </div>
                  )}
                  <p className="text-xs text-muted-foreground">
                    이 이메일도 즉시 선택한 라우팅 방식으로 처리됩니다.
                  </p>
                </div>
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel data-testid="button-confirm-cancel">Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={handleConfirm}
                data-testid="button-confirm-route"
              >
                {ACTION_CONFIG[confirmDialog.action].confirmLabel}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </AdminLayout>
  );
}
