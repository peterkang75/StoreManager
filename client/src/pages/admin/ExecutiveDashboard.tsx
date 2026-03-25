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

type StatusFilter = "ALL" | "TODO" | "IN_PROGRESS" | "DONE";

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
        data-testid={`badge-status-done`}
      >
        Done
      </Badge>
    );
  }
  if (status === "IN_PROGRESS") {
    return (
      <Badge
        className="text-xs bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300 no-default-active-elevate"
        data-testid={`badge-status-in-progress`}
      >
        In Progress
      </Badge>
    );
  }
  return (
    <Badge
      variant="secondary"
      className="text-xs no-default-active-elevate"
      data-testid={`badge-status-todo`}
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
      <span className={`text-2xl font-bold tabular-nums`}>{value}</span>
      <span className={`text-xs font-medium ${active ? "text-primary-foreground/80" : "text-muted-foreground"}`}>
        {label}
      </span>
    </button>
  );
}

// ─── Task Card ───────────────────────────────────────────────────────────────

function TaskCard({
  todo,
  onStatusChange,
  isUpdating,
}: {
  todo: Todo;
  onStatusChange: (id: string, status: string) => void;
  isUpdating: boolean;
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
                    overdue
                      ? "text-red-600 dark:text-red-400"
                      : "text-muted-foreground"
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

          {/* Action button */}
          <Button
            size="sm"
            variant={todo.status === "IN_PROGRESS" ? "default" : "outline"}
            onClick={() => onStatusChange(todo.id, STATUS_NEXT[todo.status])}
            disabled={isUpdating}
            data-testid={`button-todo-status-${todo.id}`}
            className="shrink-0"
          >
            {isUpdating ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : (
              <ActionIcon className="w-3 h-3" />
            )}
            <span className="ml-1.5">{actionLabel}</span>
          </Button>
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
                  <FormLabel>Description <span className="text-muted-foreground font-normal">(optional)</span></FormLabel>
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
                  <FormLabel>Due Date <span className="text-muted-foreground font-normal">(optional)</span></FormLabel>
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
                {mutation.isPending && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
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

  // Counts
  const countAll = todos.length;
  const countTodo = todos.filter((t) => t.status === "TODO").length;
  const countInProgress = todos.filter((t) => t.status === "IN_PROGRESS").length;
  const countDone = todos.filter((t) => t.status === "DONE").length;

  const filtered =
    filter === "ALL"
      ? todos
      : todos.filter((t) => t.status === filter);

  const sorted = [...filtered].sort((a, b) => {
    // Overdue first, then by createdAt desc
    const aOver = isOverdue(a.dueDate) && a.status !== "DONE";
    const bOver = isOverdue(b.dueDate) && b.status !== "DONE";
    if (aOver !== bOver) return aOver ? -1 : 1;
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });

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
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard
            label="All Tasks"
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
          <StatCard
            label="Done"
            value={countDone}
            active={filter === "DONE"}
            onClick={() => setFilter("DONE")}
            testId="stat-done"
          />
        </div>

        {/* Filter label */}
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <ListTodo className="w-4 h-4" />
          <span>
            {filter === "ALL"
              ? `All tasks (${sorted.length})`
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
                  ? "No tasks yet. Tasks will appear here when your AI detects action items in your emails."
                  : `No tasks with status "${STATUS_LABEL[filter]}".`}
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
              />
            ))}
          </div>
        )}
      </div>

      <AddTaskModal open={addOpen} onClose={() => setAddOpen(false)} />
    </AdminLayout>
  );
}
