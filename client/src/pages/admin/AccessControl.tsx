import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { AdminLayout } from "@/components/layouts/AdminLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ShieldCheck, Save, Loader2, RotateCcw } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAdminRole } from "@/contexts/AdminRoleContext";
import { useLocation } from "wouter";
import type { AdminPermission } from "@shared/schema";

const ROLES = ["ADMIN", "MANAGER", "STAFF"] as const;
type Role = (typeof ROLES)[number];

const ROLE_LABELS: Record<Role, string> = {
  ADMIN: "Global Admin",
  MANAGER: "Manager",
  STAFF: "Staff",
};

const ROLE_COLORS: Record<Role, string> = {
  ADMIN: "text-blue-700 dark:text-blue-400",
  MANAGER: "text-purple-700 dark:text-purple-400",
  STAFF: "text-green-700 dark:text-green-400",
};

function buildMatrix(perms: AdminPermission[]) {
  const matrix: Record<string, Record<Role, boolean>> = {};
  const labelsMap: Record<string, string> = {};
  for (const p of perms) {
    if (!matrix[p.route]) matrix[p.route] = { ADMIN: true, MANAGER: false, STAFF: false };
    matrix[p.route][p.role as Role] = p.allowed;
    labelsMap[p.route] = p.label;
  }
  return { matrix, labelsMap };
}

function flattenMatrix(
  matrix: Record<string, Record<Role, boolean>>,
  labelsMap: Record<string, string>,
): AdminPermission[] {
  const result: AdminPermission[] = [];
  for (const [route, roles] of Object.entries(matrix)) {
    for (const role of ROLES) {
      result.push({ role, route, label: labelsMap[route] ?? route, allowed: roles[role] });
    }
  }
  return result;
}

export function AdminAccessControl() {
  const { currentRole, hasAccess } = useAdminRole();
  const [, navigate] = useLocation();
  const { toast } = useToast();

  // Only ADMIN can access this page
  useEffect(() => {
    if (currentRole !== "ADMIN") {
      navigate("/admin");
    }
  }, [currentRole, navigate]);

  const { data: permissions = [], isLoading } = useQuery<AdminPermission[]>({
    queryKey: ["/api/permissions"],
  });

  const [matrix, setMatrix] = useState<Record<string, Record<Role, boolean>>>({});
  const [labelsMap, setLabelsMap] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (permissions.length > 0) {
      const { matrix: m, labelsMap: l } = buildMatrix(permissions);
      setMatrix(m);
      setLabelsMap(l);
      setDirty(false);
    }
  }, [permissions]);

  const saveMutation = useMutation({
    mutationFn: async (perms: AdminPermission[]) =>
      apiRequest("PATCH", "/api/permissions", { permissions: perms }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/permissions"] });
      toast({ title: "Access control saved" });
      setDirty(false);
    },
    onError: () => toast({ title: "Failed to save", variant: "destructive" }),
  });

  function handleToggle(route: string, role: Role) {
    if (role === "ADMIN") return; // ADMIN always has access
    setMatrix((prev) => ({
      ...prev,
      [route]: {
        ...prev[route],
        [role]: !prev[route][role],
      },
    }));
    setDirty(true);
  }

  function handleReset() {
    const { matrix: m, labelsMap: l } = buildMatrix(permissions);
    setMatrix(m);
    setLabelsMap(l);
    setDirty(false);
  }

  function handleSave() {
    saveMutation.mutate(flattenMatrix(matrix, labelsMap));
  }

  const routes = Object.keys(matrix).sort((a, b) => a.localeCompare(b));

  if (currentRole !== "ADMIN") return null;

  return (
    <AdminLayout title="Access Control">
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold flex items-center gap-2">
              <ShieldCheck className="w-5 h-5 text-primary" />
              Access Control Matrix
            </h2>
            <p className="text-sm text-muted-foreground mt-0.5">
              역할별 페이지 접근 권한을 관리합니다. Global Admin은 항상 전체 접근 권한을 가집니다.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleReset}
              disabled={!dirty || saveMutation.isPending}
              data-testid="button-reset-permissions"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Reset
            </Button>
            <Button
              size="sm"
              onClick={handleSave}
              disabled={!dirty || saveMutation.isPending}
              data-testid="button-save-permissions"
            >
              {saveMutation.isPending ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Save className="w-3.5 h-3.5" />
              )}
              Save Changes
            </Button>
          </div>
        </div>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Page Permissions</CardTitle>
            <CardDescription>체크박스를 클릭하여 각 역할의 페이지 접근을 허용하거나 차단합니다.</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="p-6 space-y-3">
                {[1, 2, 3, 4, 5].map((i) => (
                  <Skeleton key={i} className="h-10 w-full" />
                ))}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm" data-testid="table-permissions">
                  <thead>
                    <tr className="border-b border-border/40 bg-muted/30">
                      <th className="py-3 px-4 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                        Page / Feature
                      </th>
                      {ROLES.map((role) => (
                        <th
                          key={role}
                          className="py-3 px-4 text-center text-xs font-semibold uppercase tracking-wide w-32"
                        >
                          <span className={ROLE_COLORS[role]}>{ROLE_LABELS[role]}</span>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {routes.map((route) => (
                      <tr
                        key={route}
                        className="border-b border-border/10 last:border-0 hover:bg-muted/10 transition-colors"
                        data-testid={`row-perm-${route.replace(/\//g, "-")}`}
                      >
                        <td className="py-3 px-4">
                          <div className="font-medium">{labelsMap[route] ?? route}</div>
                          <div className="text-xs text-muted-foreground font-mono">{route}</div>
                        </td>
                        {ROLES.map((role) => {
                          const checked = matrix[route]?.[role] ?? false;
                          const locked = role === "ADMIN";
                          return (
                            <td key={role} className="py-3 px-4 text-center">
                              <input
                                type="checkbox"
                                checked={checked}
                                disabled={locked}
                                onChange={() => handleToggle(route, role)}
                                className="w-4 h-4 rounded accent-primary cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
                                data-testid={`checkbox-perm-${role}-${route.replace(/\//g, "-")}`}
                                title={locked ? "Global Admin always has access" : undefined}
                              />
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        <div className="rounded-md border border-amber-400/30 bg-amber-400/5 px-4 py-3 text-sm text-amber-700 dark:text-amber-400">
          <strong>참고:</strong> 현재 역할 전환은 사이드바 헤더의 드롭다운을 통해 시뮬레이션할 수 있습니다.
          실제 배포 환경에서는 로그인 시스템과 연동하여 적용됩니다.
        </div>
      </div>
    </AdminLayout>
  );
}
