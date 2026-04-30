// Phase B: client-side route guard. Wraps admin pages.
// - Loading: show a tiny placeholder
// - Not logged in: redirect to /admin/login (preserving target)
// - Logged in but role not in `allowed`: redirect to /admin (their landing)

import { ReactNode, useEffect } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/contexts/AuthContext";

interface RequireAuthProps {
  children: ReactNode;
  allowed?: string[]; // default: any logged-in admin (ADMIN/MANAGER/STAFF)
}

export function RequireAuth({ children, allowed }: RequireAuthProps) {
  const { user, loading } = useAuth();
  const [location, navigate] = useLocation();

  useEffect(() => {
    if (loading) return;
    if (!user) {
      const redirect = encodeURIComponent(location);
      navigate(`/admin/login?redirect=${redirect}`, { replace: true });
      return;
    }
    if (allowed && !allowed.includes(user.role)) {
      navigate("/admin", { replace: true });
    }
  }, [user, loading, location, navigate, allowed]);

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center text-slate-400 text-sm">
        Loading…
      </div>
    );
  }
  if (!user) return null;
  if (allowed && !allowed.includes(user.role)) return null;
  return <>{children}</>;
}
