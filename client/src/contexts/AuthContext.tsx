// Phase B: admin/manager/staff auth context. Tracks the currently logged-in
// user (id, role, email, allowed stores, allowed routes) and exposes login/
// logout helpers. Persists the bearer token in localStorage.
//
// Token keys:
//   - admin_token_v1: ADMIN/MANAGER/STAFF (email+password login)
//   - ep_portal_token_v1: EMPLOYEE (PIN login) — managed by EmployeePortal.tsx
//
// AuthContext only loads admin sessions. Portal session is handled separately.

import { createContext, useContext, useEffect, useState, ReactNode } from "react";

export const ADMIN_TOKEN_KEY = "admin_token_v1";

export interface AuthUser {
  id: string;
  email: string | null;
  firstName: string;
  lastName: string;
  nickname?: string | null;
  role: string;
  loginType?: string;
  allowedStoreIds: string[];
  allowedRoutes: string[];
  expiresAt?: string;
}

interface AuthState {
  user: AuthUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<{ ok: true } | { ok: false; error: string; minutesLeft?: number }>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  async function refresh() {
    const token = localStorage.getItem(ADMIN_TOKEN_KEY);
    if (!token) {
      setUser(null);
      setLoading(false);
      return;
    }
    try {
      const res = await fetch("/api/auth/me", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        localStorage.removeItem(ADMIN_TOKEN_KEY);
        setUser(null);
        setLoading(false);
        return;
      }
      const data = await res.json();
      // Only treat as admin context if loginType is PASSWORD (skip PIN sessions)
      if (data.loginType === "PASSWORD" && ["ADMIN", "MANAGER", "STAFF"].includes(data.role)) {
        setUser(data);
      } else {
        setUser(null);
      }
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  async function login(email: string, password: string) {
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        return {
          ok: false as const,
          error: data?.message ?? "Login failed",
          minutesLeft: data?.minutesLeft,
        };
      }
      localStorage.setItem(ADMIN_TOKEN_KEY, data.token);
      setUser(data.user);
      return { ok: true as const };
    } catch (err: any) {
      return { ok: false as const, error: err?.message ?? "Network error" };
    }
  }

  async function logout() {
    const token = localStorage.getItem(ADMIN_TOKEN_KEY);
    localStorage.removeItem(ADMIN_TOKEN_KEY);
    setUser(null);
    if (token) {
      try {
        await fetch("/api/auth/logout", {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
        });
      } catch {}
    }
  }

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, refresh }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used inside <AuthProvider>");
  }
  return ctx;
}
