import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { AdminLayout } from "@/components/layouts/AdminLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Plus, Pencil, Trash2, Megaphone, Globe, Building2 } from "lucide-react";
import type { Notice, Store } from "@shared/schema";

function fmtDate(d: string | Date) {
  return new Date(d).toLocaleDateString("en-AU", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

interface NoticeFormState {
  title: string;
  content: string;
  targetStoreId: string;
  isActive: boolean;
}

const BLANK: NoticeFormState = {
  title: "",
  content: "",
  targetStoreId: "ALL",
  isActive: true,
};

export function AdminNotices() {
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen]     = useState(false);
  const [editTarget, setEditTarget]     = useState<Notice | null>(null);
  const [form, setForm]                 = useState<NoticeFormState>(BLANK);
  const [deleteId, setDeleteId]         = useState<string | null>(null);

  const { data: notices = [], isLoading } = useQuery<Notice[]>({
    queryKey: ["/api/notices"],
    queryFn: async () => {
      const res = await fetch("/api/notices");
      if (!res.ok) throw new Error("Failed to fetch notices");
      return res.json();
    },
  });

  const { data: stores = [] } = useQuery<Store[]>({ queryKey: ["/api/stores"] });
  const activeStores = stores.filter(s => s.active && !s.isExternal);

  const createMutation = useMutation({
    mutationFn: (data: object) => apiRequest("POST", "/api/notices", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/notices"] });
      toast({ title: "Notice created" });
      setDialogOpen(false);
    },
    onError: () => toast({ title: "Failed to create notice", variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: object }) =>
      apiRequest("PUT", `/api/notices/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/notices"] });
      toast({ title: "Notice updated" });
      setDialogOpen(false);
    },
    onError: () => toast({ title: "Failed to update notice", variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/notices/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/notices"] });
      toast({ title: "Notice deleted" });
      setDeleteId(null);
    },
    onError: () => toast({ title: "Failed to delete notice", variant: "destructive" }),
  });

  function openCreate() {
    setEditTarget(null);
    setForm(BLANK);
    setDialogOpen(true);
  }

  function openEdit(n: Notice) {
    setEditTarget(n);
    setForm({
      title: n.title,
      content: n.content,
      targetStoreId: n.targetStoreId ?? "ALL",
      isActive: n.isActive,
    });
    setDialogOpen(true);
  }

  function handleSubmit() {
    const payload = {
      title: form.title.trim(),
      content: form.content.trim(),
      targetStoreId: form.targetStoreId === "ALL" ? null : form.targetStoreId,
      isActive: form.isActive,
    };
    if (!payload.title || !payload.content) {
      toast({ title: "Title and content are required", variant: "destructive" });
      return;
    }
    if (editTarget) {
      updateMutation.mutate({ id: editTarget.id, data: payload });
    } else {
      createMutation.mutate(payload);
    }
  }

  const isBusy = createMutation.isPending || updateMutation.isPending;

  const storeName = (id: string | null | undefined) => {
    if (!id) return null;
    return stores.find(s => s.id === id)?.name ?? id;
  };

  return (
    <AdminLayout title="Notices">
      <div className="space-y-6">

        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold">Notice Board</h2>
            <p className="text-sm text-muted-foreground">직원 포털에 표시할 공지사항을 관리하세요.</p>
          </div>
          <Button onClick={openCreate} data-testid="button-create-notice">
            <Plus className="w-4 h-4 mr-2" />
            New Notice
          </Button>
        </div>

        {/* Notices list */}
        {isLoading ? (
          <div className="text-sm text-muted-foreground py-12 text-center">Loading notices...</div>
        ) : notices.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-16 gap-3 text-muted-foreground">
              <Megaphone className="w-10 h-10 opacity-30" />
              <p className="text-sm">No notices yet. Create one to communicate with your team.</p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {notices.map(n => {
              const sName = storeName(n.targetStoreId);
              return (
                <Card key={n.id} data-testid={`card-notice-${n.id}`}>
                  <CardHeader className="flex flex-row items-start justify-between gap-3 pb-2">
                    <div className="flex flex-col gap-1.5 min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <CardTitle className="text-base font-semibold leading-tight">
                          {n.title}
                        </CardTitle>
                        <Badge
                          className={n.isActive
                            ? "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400 no-default-active-elevate"
                            : "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400 no-default-active-elevate"
                          }
                          data-testid={`badge-notice-status-${n.id}`}
                        >
                          {n.isActive ? "Active" : "Inactive"}
                        </Badge>
                        <Badge
                          className="bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400 no-default-active-elevate"
                          data-testid={`badge-notice-target-${n.id}`}
                        >
                          {sName ? (
                            <><Building2 className="w-3 h-3 mr-1" />{sName}</>
                          ) : (
                            <><Globe className="w-3 h-3 mr-1" />All Stores</>
                          )}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">{fmtDate(n.createdAt)}</p>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => openEdit(n)}
                        data-testid={`button-edit-notice-${n.id}`}
                      >
                        <Pencil className="w-4 h-4" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => setDeleteId(n.id)}
                        data-testid={`button-delete-notice-${n.id}`}
                      >
                        <Trash2 className="w-4 h-4 text-destructive" />
                      </Button>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm text-muted-foreground whitespace-pre-line leading-relaxed">
                      {n.content}
                    </p>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      {/* Create / Edit dialog */}
      <Dialog open={dialogOpen} onOpenChange={open => { if (!isBusy) setDialogOpen(open); }}>
        <DialogContent aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>{editTarget ? "Edit Notice" : "New Notice"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="notice-title">Title</Label>
              <Input
                id="notice-title"
                placeholder="e.g. Public Holiday reminder"
                value={form.title}
                onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                data-testid="input-notice-title"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="notice-content">Content</Label>
              <Textarea
                id="notice-content"
                placeholder="Write your announcement here..."
                rows={5}
                value={form.content}
                onChange={e => setForm(f => ({ ...f, content: e.target.value }))}
                data-testid="input-notice-content"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Target Store</Label>
              <Select
                value={form.targetStoreId}
                onValueChange={v => setForm(f => ({ ...f, targetStoreId: v }))}
              >
                <SelectTrigger data-testid="select-notice-store">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">
                    <span className="flex items-center gap-1.5">
                      <Globe className="w-3.5 h-3.5" /> All Stores
                    </span>
                  </SelectItem>
                  {activeStores.map(s => (
                    <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                "All Stores" = shown to every employee. Select a specific store to target only that team.
              </p>
            </div>
            <div className="flex items-center justify-between rounded-md border px-3 py-2.5">
              <div>
                <p className="text-sm font-medium">Active</p>
                <p className="text-xs text-muted-foreground">Inactive notices are hidden from employees</p>
              </div>
              <Switch
                checked={form.isActive}
                onCheckedChange={v => setForm(f => ({ ...f, isActive: v }))}
                data-testid="switch-notice-active"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={isBusy}>
              Cancel
            </Button>
            <Button onClick={handleSubmit} disabled={isBusy} data-testid="button-save-notice">
              {isBusy ? "Saving..." : editTarget ? "Save Changes" : "Create Notice"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <Dialog open={!!deleteId} onOpenChange={open => { if (!open) setDeleteId(null); }}>
        <DialogContent aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>Delete Notice</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground py-2">
            Are you sure you want to delete this notice? This cannot be undone.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteId(null)}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={() => deleteId && deleteMutation.mutate(deleteId)}
              disabled={deleteMutation.isPending}
              data-testid="button-confirm-delete-notice"
            >
              {deleteMutation.isPending ? "Deleting..." : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
}
