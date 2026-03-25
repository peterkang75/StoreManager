import { createContext, useContext, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { AdminPermission } from "@shared/schema";

export type AdminRole = "ADMIN" | "MANAGER" | "STAFF";

interface AdminRoleContextValue {
  currentRole: AdminRole;
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
  const [currentRole, setCurrentRoleState] = useState<AdminRole>(
    () => (localStorage.getItem("admin_role_v1") as AdminRole) ?? "ADMIN",
  );

  const { data: permissions = [], isLoading: permissionsLoading } = useQuery<AdminPermission[]>({
    queryKey: ["/api/permissions"],
  });

  function setCurrentRole(role: AdminRole) {
    localStorage.setItem("admin_role_v1", role);
    setCurrentRoleState(role);
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
