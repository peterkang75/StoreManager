// Phase B: admin/manager/staff login page.
// Airbnb minimalism per design.md — single-column, generous radius, warm shadow.
// Mobile-responsive: managers may log in from phone.

import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AlertCircle, Loader2, Lock } from "lucide-react";

export function AdminLogin() {
  const { login, user } = useAuth();
  const [, navigate] = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // Device-binding: when a PIN-portal session already exists on this device,
  // the email field is locked to that user. Owner can't log in on the
  // manager's phone — the manager must portal-logout first. Backend mirrors
  // this constraint in /api/auth/login.
  const [pinUserEmail, setPinUserEmail] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const pinToken = (() => {
      try { return localStorage.getItem("ep_portal_token_v1"); } catch { return null; }
    })();
    if (!pinToken) return;
    fetch("/api/auth/me", { headers: { Authorization: `Bearer ${pinToken}` } })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled) return;
        if (data?.loginType === "PIN" && typeof data?.email === "string" && data.email.trim()) {
          setPinUserEmail(data.email);
          setEmail(data.email);
        }
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  // If already logged in, kick to /admin (or saved redirect)
  if (user) {
    const params = new URLSearchParams(window.location.search);
    const redirect = params.get("redirect") || "/admin";
    setTimeout(() => navigate(redirect, { replace: true }), 0);
    return null;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    const result = await login(email.trim(), password);
    setSubmitting(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    const params = new URLSearchParams(window.location.search);
    const redirect = params.get("redirect") || "/admin";
    navigate(redirect, { replace: true });
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#f7f7f7] dark:bg-slate-900 p-4">
      <div className="w-full max-w-md">
        {/* Crew wordmark */}
        <div className="text-center mb-8">
          <div className="inline-flex items-baseline">
            <span className="text-4xl font-bold tracking-tight text-slate-900 dark:text-slate-50">
              Crew
            </span>
            <span className="text-[#ef4444] font-bold leading-none" style={{ fontSize: "2rem" }}>.</span>
          </div>
          <div className="mt-2 text-xs uppercase tracking-widest text-slate-400">
            Admin Portal
          </div>
        </div>

        {/* Card */}
        <div className="bg-white dark:bg-slate-800 rounded-[20px] shadow-[0_2px_4px_rgba(0,0,0,0.04),0_8px_16px_rgba(0,0,0,0.06),0_24px_32px_rgba(0,0,0,0.04)] p-6 sm:p-8">
          <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-50 mb-1">
            Sign in
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mb-6">
            Use your work email and password.
          </p>

          {pinUserEmail && (
            <div className="mb-5 flex items-start gap-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/40 px-3 py-2.5 text-xs text-slate-600 dark:text-slate-300">
              <Lock className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
              <span>
                이 기기는 <strong>{pinUserEmail}</strong>로 portal에 로그인되어 있습니다.
                다른 계정으로 들어가려면 portal에서 먼저 로그아웃하세요.
              </span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <Label htmlFor="email" className="text-sm text-slate-700 dark:text-slate-300">
                Email
              </Label>
              <Input
                id="email"
                type="email"
                inputMode="email"
                autoComplete="email"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                readOnly={!!pinUserEmail}
                className={`mt-1.5 h-11 rounded-xl ${pinUserEmail ? "bg-slate-100 dark:bg-slate-900 text-slate-500 cursor-not-allowed" : ""}`}
                placeholder="you@company.com"
                disabled={submitting}
                data-testid="login-email"
              />
            </div>

            <div>
              <Label htmlFor="password" className="text-sm text-slate-700 dark:text-slate-300">
                Password
              </Label>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="mt-1.5 h-11 rounded-xl"
                placeholder="••••••••"
                disabled={submitting}
                data-testid="login-password"
              />
            </div>

            {error && (
              <div className="flex items-start gap-2 text-sm text-[#ef4444] bg-red-50 dark:bg-red-950/20 border border-red-100 dark:border-red-900/40 rounded-xl px-3 py-2.5">
                <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <Button
              type="submit"
              disabled={submitting || !email || !password}
              className="w-full h-11 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-medium"
              data-testid="login-submit"
            >
              {submitting ? (
                <span className="flex items-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Signing in…
                </span>
              ) : (
                "Sign in"
              )}
            </Button>
          </form>

          <p className="text-xs text-slate-400 dark:text-slate-500 mt-6 text-center">
            Forgot your password? Ask the owner to reset it.
          </p>
        </div>

        {/* Employee link */}
        <p className="text-center text-sm text-slate-500 dark:text-slate-400 mt-6">
          Employee?{" "}
          <a href="/m/portal" className="text-slate-900 dark:text-slate-200 font-medium underline decoration-slate-300 hover:decoration-slate-900">
            Use the staff portal
          </a>
        </p>
      </div>
    </div>
  );
}
