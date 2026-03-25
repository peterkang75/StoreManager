import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { AdminLayout } from "@/components/layouts/AdminLayout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Form,
  FormField,
  FormItem,
  FormLabel,
  FormControl,
  FormMessage,
} from "@/components/ui/form";
import {
  Plus,
  CheckCircle2,
  Circle,
  RotateCcw,
  PlayCircle,
  Mail,
  CalendarClock,
  Inbox,
  ListTodo,
  Loader2,
  ChevronDown,
  ChevronUp,
  Send,
  Sparkles,
  FileText,
  MessageSquare,
} from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { Todo } from "@shared/schema";

// ─── helpers ────────────────────────────────────────────────────────────────

function formatDueDate(date: string | Date | null): string | null {
  if (!date) return null;
  return new Date(date).toLocaleDateString("en-AU", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function isOverdue(date: string | Date | null): boolean {
  if (!date) return false;
  return new Date(date) < new Date(new Date().toDateString());
}

type StatusFilter = "ALL" | "TODO" | "IN_PROGRESS";

const STATUS_NEXT: Record<string, string> = {
  TODO: "IN_PROGRESS",
  IN_PROGRESS: "DONE",
  DONE: "TODO",
};

const STATUS_LABEL: Record<string, string> = {
  TODO: "To Do",
  IN_PROGRESS: "In Progress",
  DONE: "Done",
};

// ─── Add Task form schema ────────────────────────────────────────────────────

const addTaskSchema = z.object({
  title: z.string().min(1, "Title is required").max(200),
  description: z.string().max(2000).optional(),
  dueDate: z.string().optional(),
});
type AddTaskForm = z.infer<typeof addTaskSchema>;

// ─── Status Badge ────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  if (status === "DONE") {
    return (
      <Badge
        className="text-xs bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300 no-default-active-elevate"
        data-testid="badge-status-done"
      >
        Done
      </Badge>
    );
  }
  if (status === "IN_PROGRESS") {
    return (
      <Badge
        className="text-xs bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300 no-default-active-elevate"
        data-testid="badge-status-in-progress"
      >
        In Progress
      </Badge>
    );
  }
  return (
    <Badge
      variant="secondary"
      className="text-xs no-default-active-elevate"
      data-testid="badge-status-todo"
    >
      To Do
    </Badge>
  );
}

// ─── Summary Stats ───────────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  active,
  onClick,
  testId,
}: {
  label: string;
  value: number;
  active: boolean;
  onClick: () => void;
  testId: string;
}) {
  return (
    <button
      onClick={onClick}
      data-testid={testId}
      className={`flex flex-col items-start gap-1 rounded-md px-5 py-4 border transition-colors text-left w-full hover-elevate ${
        active
          ? "bg-primary text-primary-foreground border-primary"
          : "bg-card border-border text-card-foreground"
      }`}
    >
      <span className="text-2xl font-bold tabular-nums">{value}</span>
      <span className={`text-xs font-medium ${active ? "text-primary-foreground/80" : "text-muted-foreground"}`}>
        {label}
      </span>
    </button>
  );
}

// ─── Email Reply Modal ────────────────────────────────────────────────────────

function EmailReplyModal({
  todo,
  open,
  onClose,
}: {
  todo: Todo | null;
  open: boolean;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const [koreanDraft, setKoreanDraft] = useState("");
  const [englishReply, setEnglishReply] = useState("");

  const draftMutation = useMutation({
    mutationFn: async (draft: string) => {
      const res = await apiRequest("POST", `/api/todos/${todo!.id}/draft-reply`, { koreanDraft: draft });
      return res.json();
    },
    onSuccess: (data: { englishReply: string }) => {
      setEnglishReply(data.englishReply);
    },
    onError: () => toast({ title: "Translation failed", variant: "destructive" }),
  });

  const sendMutation = useMutation({
    mutationFn: async (reply: string) => {
      const res = await apiRequest("POST", `/api/todos/${todo!.id}/send-reply`, { finalEnglishReply: reply });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/todos"] });
      toast({ title: "Reply sent successfully", description: "Task has been marked as done." });
      onClose();
    },
    onError: () => toast({ title: "Failed to send reply", variant: "destructive" }),
  });

  function handleClose() {
    setKoreanDraft("");
    setEnglishReply("");
    onClose();
  }

  if (!todo) return null;

  const hasEmailContext = !!(todo.originalSubject || todo.originalBody || todo.senderEmail);

  return (
    <Dialog open={open} onOpenChange={(v) => !v && handleClose()}>
      <DialogContent
        className="max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col"
        data-testid="modal-reply"
      >
        <DialogHeader className="shrink-0">
          <DialogTitle className="flex items-center gap-2">
            <Mail className="w-4 h-4 text-primary" />
            View & Reply
          </DialogTitle>
          <DialogDescription className="text-sm text-muted-foreground">
            {(todo.senderEmail || todo.sourceEmail)
              ? `Replying to: ${todo.senderEmail || todo.sourceEmail}`
              : "Review the task and compose a reply"}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 min-h-0 overflow-auto">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pb-2">
            {/* ── Left: Context Panel ──────────────────────────────── */}
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <FileText className="w-4 h-4 text-muted-foreground" />
                원문 이메일 (Original Email)
              </div>

              {hasEmailContext ? (
                <div className="space-y-3">
                  {todo.originalSubject && (
                    <div>
                      <p className="text-xs font-medium text-muted-foreground mb-1">Subject</p>
                      <p
                        className="text-sm font-medium bg-muted/40 rounded-md px-3 py-2 border border-border/60"
                        data-testid="text-original-subject"
                      >
                        {todo.originalSubject}
                      </p>
                    </div>
                  )}
                  {todo.originalBody && (
                    <div>
                      <p className="text-xs font-medium text-muted-foreground mb-1">Body</p>
                      <div
                        className="text-sm bg-muted/40 rounded-md px-3 py-2 border border-border/60 max-h-40 overflow-y-auto whitespace-pre-wrap leading-relaxed text-foreground/80"
                        data-testid="text-original-body"
                      >
                        {todo.originalBody}
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="rounded-md border border-border/60 bg-muted/20 px-3 py-4 text-sm text-muted-foreground text-center">
                  이 작업은 수동으로 생성되어 원본 이메일 내용이 없습니다.
                </div>
              )}

              <Separator />

              <div className="flex items-center gap-2 text-sm font-semibold">
                <MessageSquare className="w-4 h-4 text-muted-foreground" />
                AI 한국어 요약
              </div>

              <div
                className="rounded-md border border-primary/20 bg-primary/5 px-3 py-3 space-y-1"
                data-testid="panel-korean-summary"
              >
                <p
                  className="text-sm font-semibold text-foreground"
                  data-testid="text-task-title-korean"
                >
                  {todo.title}
                </p>
                {todo.description && (
                  <p
                    className="text-sm text-muted-foreground leading-relaxed"
                    data-testid="text-task-description-korean"
                  >
                    {todo.description}
                  </p>
                )}
              </div>
            </div>

            {/* ── Right: Action Panel ──────────────────────────────── */}
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <Send className="w-4 h-4 text-muted-foreground" />
                한국어로 지시 → 영어 답장
              </div>

              {/* Step 1: Korean input */}
              <div className="space-y-2">
                <p className="text-xs font-medium text-muted-foreground">
                  1단계: 한국어로 지시사항을 작성하세요
                </p>
                <Textarea
                  placeholder="한국어로 지시사항을 작성하세요... (예: 이번 주 금요일까지 견적서를 보내달라고 요청하세요)"
                  value={koreanDraft}
                  onChange={(e) => setKoreanDraft(e.target.value)}
                  rows={4}
                  className="resize-none text-sm"
                  data-testid="textarea-korean-draft"
                />
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!koreanDraft.trim() || draftMutation.isPending}
                  onClick={() => draftMutation.mutate(koreanDraft)}
                  data-testid="button-translate"
                  className="w-full"
                >
                  {draftMutation.isPending ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      Translating...
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-3.5 h-3.5" />
                      Translate to Professional English
                    </>
                  )}
                </Button>
              </div>

              {/* Step 2: English reply */}
              <div className="space-y-2">
                <p className="text-xs font-medium text-muted-foreground">
                  2단계: 영어 답장을 확인 및 수정 후 발송
                </p>
                <Textarea
                  placeholder="번역된 영어 답장이 여기에 표시됩니다..."
                  value={englishReply}
                  onChange={(e) => setEnglishReply(e.target.value)}
                  rows={6}
                  className="resize-none text-sm"
                  data-testid="textarea-english-reply"
                />
                <Button
                  disabled={!englishReply.trim() || sendMutation.isPending || !(todo.senderEmail || todo.sourceEmail)}
                  onClick={() => sendMutation.mutate(englishReply)}
                  data-testid="button-send-reply"
                  className="w-full"
                >
                  {sendMutation.isPending ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      Sending...
                    </>
                  ) : (
                    <>
                      <Send className="w-3.5 h-3.5" />
                      Send English Reply
                    </>
                  )}
                </Button>
                {!todo.senderEmail && (
                  <p className="text-xs text-muted-foreground text-center">
                    발신자 이메일 정보가 없어 발송이 불가합니다. 수동으로 생성된 작업입니다.
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>

        <DialogFooter className="shrink-0 pt-2 border-t border-border/60">
          <Button variant="outline" onClick={handleClose} data-testid="button-reply-close">
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Task Card ───────────────────────────────────────────────────────────────

function TaskCard({
  todo,
  onStatusChange,
  isUpdating,
  onReply,
}: {
  todo: Todo;
  onStatusChange: (id: string, status: string) => void;
  isUpdating: boolean;
  onReply: (todo: Todo) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const overdue = isOverdue(todo.dueDate) && todo.status !== "DONE";
  const dueFmt = formatDueDate(todo.dueDate);
  const isDone = todo.status === "DONE";

  const ActionIcon =
    todo.status === "TODO"
      ? PlayCircle
      : todo.status === "IN_PROGRESS"
      ? CheckCircle2
      : RotateCcw;

  const actionLabel =
    todo.status === "TODO"
      ? "Start"
      : todo.status === "IN_PROGRESS"
      ? "Complete"
      : "Reopen";

  const hasDescription = todo.description && todo.description.trim().length > 0;
  const isLong = hasDescription && todo.description!.length > 160;

  const hasEmailContext = !!(todo.senderEmail || todo.originalSubject || todo.sourceEmail);

  return (
    <Card
      className={`transition-opacity ${isDone ? "opacity-60" : "opacity-100"}`}
      data-testid={`card-todo-${todo.id}`}
    >
      <CardContent className="p-5">
        <div className="flex items-start gap-4">
          {/* Status action button */}
          <button
            onClick={() => onStatusChange(todo.id, STATUS_NEXT[todo.status])}
            disabled={isUpdating}
            data-testid={`button-todo-action-${todo.id}`}
            className="mt-0.5 shrink-0 text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
            title={actionLabel}
          >
            {isUpdating ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : isDone ? (
              <CheckCircle2 className="w-5 h-5 text-green-600 dark:text-green-400" />
            ) : (
              <Circle className="w-5 h-5" />
            )}
          </button>

          {/* Main content */}
          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-2 mb-1">
              <span
                className={`font-semibold text-sm leading-snug ${isDone ? "line-through text-muted-foreground" : "text-foreground"}`}
                data-testid={`text-todo-title-${todo.id}`}
              >
                {todo.title}
              </span>
              <StatusBadge status={todo.status} />
              {hasEmailContext && !isDone && (
                <Badge
                  variant="outline"
                  className="text-xs text-primary border-primary/30 bg-primary/5 no-default-active-elevate"
                  data-testid={`badge-has-email-${todo.id}`}
                >
                  <Mail className="w-2.5 h-2.5 mr-1" />
                  이메일
                </Badge>
              )}
            </div>

            {/* Description */}
            {hasDescription && (
              <div className="mb-2">
                <p
                  className="text-sm text-muted-foreground leading-relaxed"
                  data-testid={`text-todo-description-${todo.id}`}
                >
                  {isLong && !expanded
                    ? todo.description!.slice(0, 160) + "…"
                    : todo.description}
                </p>
                {isLong && (
                  <button
                    onClick={() => setExpanded((v) => !v)}
                    className="mt-1 text-xs text-muted-foreground hover:text-foreground flex items-center gap-0.5 transition-colors"
                    data-testid={`button-todo-expand-${todo.id}`}
                  >
                    {expanded ? (
                      <>
                        <ChevronUp className="w-3 h-3" /> Show less
                      </>
                    ) : (
                      <>
                        <ChevronDown className="w-3 h-3" /> Show more
                      </>
                    )}
                  </button>
                )}
              </div>
            )}

            {/* Meta row */}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-1">
              {dueFmt && (
                <span
                  className={`flex items-center gap-1 text-xs font-medium ${
                    overdue ? "text-red-600 dark:text-red-400" : "text-muted-foreground"
                  }`}
                  data-testid={`text-todo-due-${todo.id}`}
                >
                  <CalendarClock className="w-3 h-3" />
                  {overdue ? "Overdue · " : "Due "}
                  {dueFmt}
                </span>
              )}
              {todo.sourceEmail && (
                <span
                  className="flex items-center gap-1 text-xs text-muted-foreground"
                  data-testid={`text-todo-source-${todo.id}`}
                >
                  <Mail className="w-3 h-3" />
                  {todo.sourceEmail}
                </span>
              )}
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-2 shrink-0">
            {/* View & Reply button — only for email-originated tasks */}
            {hasEmailContext && !isDone && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => onReply(todo)}
                data-testid={`button-todo-reply-${todo.id}`}
                className="text-primary border-primary/30 bg-primary/5"
              >
                <Mail className="w-3 h-3" />
                View & Reply
              </Button>
            )}

            <Button
              size="sm"
              variant={todo.status === "IN_PROGRESS" ? "default" : "outline"}
              onClick={() => onStatusChange(todo.id, STATUS_NEXT[todo.status])}
              disabled={isUpdating}
              data-testid={`button-todo-status-${todo.id}`}
            >
              {isUpdating ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : (
                <ActionIcon className="w-3 h-3" />
              )}
              <span className="ml-1.5">{actionLabel}</span>
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Add Task Modal ──────────────────────────────────────────────────────────

function AddTaskModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const form = useForm<AddTaskForm>({
    resolver: zodResolver(addTaskSchema),
    defaultValues: { title: "", description: "", dueDate: "" },
  });

  const mutation = useMutation({
    mutationFn: (data: AddTaskForm) =>
      apiRequest("POST", "/api/todos", {
        title: data.title,
        description: data.description || null,
        dueDate: data.dueDate || null,
        status: "TODO",
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/todos"] });
      toast({ title: "Task added" });
      form.reset();
      onClose();
    },
    onError: () => {
      toast({ title: "Failed to add task", variant: "destructive" });
    },
  });

  function onSubmit(data: AddTaskForm) {
    mutation.mutate(data);
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md" data-testid="modal-add-task">
        <DialogHeader>
          <DialogTitle>Add Task</DialogTitle>
          <DialogDescription>
            Manually create a task to track an action item.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="title"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Title</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="What needs to be done?"
                      {...field}
                      data-testid="input-task-title"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    Description{" "}
                    <span className="text-muted-foreground font-normal">(optional)</span>
                  </FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="Add more detail…"
                      rows={3}
                      {...field}
                      data-testid="input-task-description"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="dueDate"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    Due Date{" "}
                    <span className="text-muted-foreground font-normal">(optional)</span>
                  </FormLabel>
                  <FormControl>
                    <Input
                      type="date"
                      {...field}
                      data-testid="input-task-due-date"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={onClose}
                data-testid="button-task-cancel"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={mutation.isPending}
                data-testid="button-task-submit"
              >
                {mutation.isPending && (
                  <Loader2 className="w-4 h-4 animate-spin mr-2" />
                )}
                Add Task
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

// ─── Main Page ───────────────────────────────────────────────────────────────

export function AdminExecutiveDashboard() {
  const [filter, setFilter] = useState<StatusFilter>("ALL");
  const [addOpen, setAddOpen] = useState(false);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [doneOpen, setDoneOpen] = useState(false);
  const [replyTarget, setReplyTarget] = useState<Todo | null>(null);
  const { toast } = useToast();

  const { data: todos = [], isLoading } = useQuery<Todo[]>({
    queryKey: ["/api/todos"],
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      apiRequest("PATCH", `/api/todos/${id}`, { status }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/todos"] });
    },
    onError: () => {
      toast({ title: "Failed to update task", variant: "destructive" });
    },
    onSettled: () => setUpdatingId(null),
  });

  function handleStatusChange(id: string, nextStatus: string) {
    setUpdatingId(id);
    updateMutation.mutate({ id, status: nextStatus });
  }

  // Split done from active
  const activeTodos = todos.filter((t) => t.status !== "DONE");
  const doneTodos = todos.filter((t) => t.status === "DONE");

  // Counts
  const countAll = activeTodos.length;
  const countTodo = activeTodos.filter((t) => t.status === "TODO").length;
  const countInProgress = activeTodos.filter((t) => t.status === "IN_PROGRESS").length;
  const countDone = doneTodos.length;

  const filtered =
    filter === "ALL"
      ? activeTodos
      : activeTodos.filter((t) => t.status === filter);

  const sorted = [...filtered].sort((a, b) => {
    // Overdue first, then by createdAt desc
    const aOver = isOverdue(a.dueDate);
    const bOver = isOverdue(b.dueDate);
    if (aOver !== bOver) return aOver ? -1 : 1;
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });

  const sortedDone = [...doneTodos].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );

  return (
    <AdminLayout title="Executive Dashboard">
      <div className="space-y-6">
        {/* Header row */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold" data-testid="text-exec-heading">
              AI Smart Inbox
            </h2>
            <p className="text-sm text-muted-foreground mt-0.5">
              Tasks automatically extracted from your email by AI
            </p>
          </div>
          <Button
            onClick={() => setAddOpen(true)}
            data-testid="button-add-task"
          >
            <Plus className="w-4 h-4" />
            Add Task
          </Button>
        </div>

        {/* Summary stat cards */}
        <div className="grid grid-cols-3 gap-3">
          <StatCard
            label="All Active"
            value={countAll}
            active={filter === "ALL"}
            onClick={() => setFilter("ALL")}
            testId="stat-all"
          />
          <StatCard
            label="To Do"
            value={countTodo}
            active={filter === "TODO"}
            onClick={() => setFilter("TODO")}
            testId="stat-todo"
          />
          <StatCard
            label="In Progress"
            value={countInProgress}
            active={filter === "IN_PROGRESS"}
            onClick={() => setFilter("IN_PROGRESS")}
            testId="stat-in-progress"
          />
        </div>

        {/* Filter label */}
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <ListTodo className="w-4 h-4" />
          <span>
            {filter === "ALL"
              ? `진행 중인 작업 (${sorted.length})`
              : `${STATUS_LABEL[filter]} (${sorted.length})`}
          </span>
        </div>

        {/* Task list */}
        {isLoading ? (
          <div className="space-y-3" data-testid="skeleton-todos">
            {[1, 2, 3].map((i) => (
              <Card key={i}>
                <CardContent className="p-5">
                  <div className="flex items-start gap-4">
                    <Skeleton className="w-5 h-5 rounded-full mt-0.5 shrink-0" />
                    <div className="flex-1 space-y-2">
                      <Skeleton className="h-4 w-1/2" />
                      <Skeleton className="h-3 w-3/4" />
                      <Skeleton className="h-3 w-1/3" />
                    </div>
                    <Skeleton className="h-8 w-24 shrink-0" />
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : sorted.length === 0 ? (
          <Card>
            <CardContent className="py-16 flex flex-col items-center justify-center gap-3 text-center">
              <Inbox className="w-10 h-10 text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground" data-testid="text-todos-empty">
                {filter === "ALL"
                  ? "진행 중인 작업이 없습니다. AI가 이메일에서 할 일을 자동으로 감지하면 여기에 표시됩니다."
                  : `"${STATUS_LABEL[filter]}" 상태의 작업이 없습니다.`}
              </p>
              {filter === "ALL" && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setAddOpen(true)}
                  data-testid="button-add-task-empty"
                >
                  <Plus className="w-4 h-4" />
                  Add your first task
                </Button>
              )}
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3" data-testid="list-todos">
            {sorted.map((todo) => (
              <TaskCard
                key={todo.id}
                todo={todo}
                onStatusChange={handleStatusChange}
                isUpdating={updatingId === todo.id}
                onReply={setReplyTarget}
              />
            ))}
          </div>
        )}

        {/* Completed tasks section */}
        {!isLoading && countDone > 0 && (
          <div data-testid="section-done">
            <button
              type="button"
              onClick={() => setDoneOpen((v) => !v)}
              className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors w-full py-2"
              data-testid="button-toggle-done"
            >
              <CheckCircle2 className="w-4 h-4 text-green-600 dark:text-green-400" />
              <span className="font-medium">완료된 작업 {countDone}건</span>
              {doneOpen ? (
                <ChevronUp className="w-4 h-4 ml-1" />
              ) : (
                <ChevronDown className="w-4 h-4 ml-1" />
              )}
              <span className="flex-1 border-t border-border/40 ml-2" />
            </button>

            {doneOpen && (
              <div className="space-y-3 mt-2" data-testid="list-done-todos">
                {sortedDone.map((todo) => (
                  <TaskCard
                    key={todo.id}
                    todo={todo}
                    onStatusChange={handleStatusChange}
                    isUpdating={updatingId === todo.id}
                    onReply={setReplyTarget}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <AddTaskModal open={addOpen} onClose={() => setAddOpen(false)} />
      <EmailReplyModal
        todo={replyTarget}
        open={!!replyTarget}
        onClose={() => setReplyTarget(null)}
      />
    </AdminLayout>
  );
}
