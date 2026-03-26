import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { AdminLayout } from "@/components/layouts/AdminLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
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
} from "lucide-react";
import type { UniversalInboxItem } from "@shared/schema";

type RouteAction = "ROUTE_TO_AP" | "ROUTE_TO_TODO" | "FYI_ARCHIVE" | "SPAM_DROP";

// API enriches items with suggestedAction from stored routing rule
type TriageItem = UniversalInboxItem & { suggestedAction?: RouteAction | null };

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

interface ConfirmDialog {
  itemId: string;
  action: RouteAction;
  senderEmail: string;
}

const SUGGESTED_ACTION_LABEL: Record<RouteAction, string> = {
  ROUTE_TO_AP: "Payables",
  ROUTE_TO_TODO: "To-Do",
  FYI_ARCHIVE: "FYI",
  SPAM_DROP: "Spam",
};

function InboxItemCard({
  item,
  onAction,
  isPending,
}: {
  item: TriageItem;
  onAction: (id: string, action: RouteAction) => void;
  isPending: boolean;
}) {
  const isProcessed = item.status !== "NEEDS_ROUTING";
  const bodyPreview = item.body.slice(0, 280).trim();
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
              {item.senderName ? `${item.senderName}` : item.senderEmail}
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
        <div className="flex items-center gap-1 text-xs text-muted-foreground shrink-0">
          <Clock className="w-3 h-3" />
          <span data-testid={`text-time-${item.id}`}>
            {formatRelativeTime(item.createdAt)}
          </span>
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        {bodyPreview && (
          <p
            className="text-sm text-muted-foreground line-clamp-3 leading-relaxed"
            data-testid={`text-body-${item.id}`}
          >
            {bodyPreview}
            {item.body.length > 280 && "…"}
          </p>
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

export function AdminTriageInbox() {
  const { toast } = useToast();
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialog | null>(null);
  const [activeTab, setActiveTab] = useState("needs-routing");

  const { data: allItems = [], isLoading, refetch } = useQuery<TriageItem[]>({
    queryKey: ["/api/universal-inbox"],
  });

  const routeMutation = useMutation({
    mutationFn: async ({ id, action }: { id: string; action: RouteAction }) =>
      apiRequest("POST", `/api/universal-inbox/${id}/route`, { action }),
    onSuccess: (_data, { action }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/universal-inbox"] });
      queryClient.invalidateQueries({ queryKey: ["/api/todos"] });
      queryClient.invalidateQueries({ queryKey: ["/api/supplier-invoices"] });
      const cfg = ACTION_CONFIG[action];
      toast({
        title: "Routing rule saved",
        description: `Sender routed to "${cfg.label}". Future emails from this sender will be handled automatically.`,
      });
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

  function handleActionClick(id: string, action: RouteAction) {
    const item = allItems.find(i => i.id === id);
    if (!item) return;
    setConfirmDialog({ itemId: id, action, senderEmail: item.senderEmail });
  }

  function handleConfirm() {
    if (!confirmDialog) return;
    routeMutation.mutate({ id: confirmDialog.itemId, action: confirmDialog.action });
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

      {confirmDialog && (
        <AlertDialog open={true} onOpenChange={() => setConfirmDialog(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Confirm Routing Rule</AlertDialogTitle>
              <AlertDialogDescription asChild>
                <div className="space-y-2">
                  <p>
                    Set routing rule for <strong>{confirmDialog.senderEmail}</strong>:
                  </p>
                  <p className="text-sm">
                    {ACTION_CONFIG[confirmDialog.action].description}
                  </p>
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
