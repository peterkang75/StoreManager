import { createContext, useContext, useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import type { AdminPermission } from "@shared/schema";
import { useAuth } from "./AuthContext";

export type AdminRole = "ADMIN" | "MANAGER" | "STAFF";

interface AdminRoleContextValue {
  currentRole: AdminRole;
  // ADMIN-only: switch to preview as MANAGER/STAFF (used by AccessControl page).
  // For non-ADMIN users this is a no-op.
  setCurrentRole: (role: AdminRole) => void;
  hasAccess: (route: string) => boolean;
  permissions: AdminPermission[];
  permissionsLoading: boolean;
}

const AdminRoleContext = createContext<AdminRoleContextValue>({
  currentRole: "ADMIN",
  setCurrentRole: () => {},
  hasAccess: () => true,
  permissions: [],
  permissionsLoading: false,
});

export function AdminRoleProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();

  // Real role from auth (db-backed). Preview override only for ADMIN users.
  const realRole = (user?.role as AdminRole | undefined) ?? "ADMIN";
  const [previewRole, setPreviewRole] = useState<AdminRole | null>(() => {
    const stored = localStorage.getItem("admin_role_preview_v1");
    return stored ? (stored as AdminRole) : null;
  });

  // When the user changes (login/logout), drop any stale preview.
  useEffect(() => {
    if (!user) {
      setPreviewRole(null);
      localStorage.removeItem("admin_role_preview_v1");
    }
  }, [user]);

  const currentRole: AdminRole = (realRole === "ADMIN" && previewRole) ? previewRole : realRole;

  const { data: permissions = [], isLoading: permissionsLoading } = useQuery<AdminPermission[]>({
    queryKey: ["/api/permissions"],
  });

  function setCurrentRole(role: AdminRole) {
    // Only ADMIN can preview as another role.
    if (realRole !== "ADMIN") return;
    if (role === "ADMIN") {
      localStorage.removeItem("admin_role_preview_v1");
      setPreviewRole(null);
    } else {
      localStorage.setItem("admin_role_preview_v1", role);
      setPreviewRole(role);
    }
  }

  function hasAccess(route: string): boolean {
    if (currentRole === "ADMIN") return true;
    const perm = permissions.find((p) => p.role === currentRole && p.route === route);
    return perm?.allowed ?? false;
  }

  return (
    <AdminRoleContext.Provider value={{ currentRole, setCurrentRole, hasAccess, permissions, permissionsLoading }}>
      {children}
    </AdminRoleContext.Provider>
  );
}

export function useAdminRole() {
  return useContext(AdminRoleContext);
}
