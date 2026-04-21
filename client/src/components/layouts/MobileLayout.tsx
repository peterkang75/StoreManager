import { ArrowLeft, LayoutDashboard } from "lucide-react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";

const A = {
  font: "'Airbnb Cereal VF', Circular, -apple-system, system-ui, 'Helvetica Neue', sans-serif",
};

interface MobileLayoutProps {
  children: React.ReactNode;
  title?: string;
  backUrl?: string;
  showHeader?: boolean;
}

function loadPortalRole(): string | null {
  try {
    const portal = sessionStorage.getItem("ep_session_v4");
    if (portal) {
      const s = JSON.parse(portal);
      if (s?.role) return String(s.role).toUpperCase();
    }
    const legacy = localStorage.getItem("mobile_session");
    if (legacy) {
      const s = JSON.parse(legacy);
      if (s?.role) return String(s.role).toUpperCase();
    }
  } catch {}
  return null;
}

export function MobileLayout({
  children,
  title,
  backUrl,
  showHeader = true,
}: MobileLayoutProps) {
  const role = loadPortalRole();

  const { data: permissions = [] } = useQuery<Array<{ role: string; route: string; allowed: boolean }>>({
    queryKey: ["/api/permissions"],
    enabled: role === "MANAGER",
    staleTime: 60_000,
  });

  const isAdmin =
    role === "OWNER" ||
    (role === "MANAGER" && permissions.some(p => p.role === "MANAGER" && p.allowed));

  return (
    <div style={{ minHeight: "100vh", background: "#ffffff", display: "flex", flexDirection: "column", fontFamily: A.font }}>
      {showHeader && (
        <header
          data-testid="text-mobile-title"
          style={{
            height: 56,
            display: "flex",
            alignItems: "center",
            gap: 12,
            padding: "0 16px",
            background: "rgba(255,255,255,0.9)",
            backdropFilter: "blur(12px)",
            WebkitBackdropFilter: "blur(12px)",
            borderBottom: "1px solid #c1c1c1",
            position: "sticky",
            top: 0,
            zIndex: 40,
          }}
        >
          {backUrl && (
            <Link href={backUrl}>
              <button
                type="button"
                data-testid="button-back"
                style={{ width: 36, height: 36, borderRadius: "50%", background: "#f2f2f2", border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}
              >
                <ArrowLeft style={{ width: 18, height: 18, color: "#222222" }} />
              </button>
            </Link>
          )}
          {title && (
            <h1 style={{ fontSize: 18, fontWeight: 700, color: "#222222", letterSpacing: "-0.18px", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", margin: 0 }}>
              {title}
            </h1>
          )}
          {isAdmin && (
            <Link href="/admin">
              <button
                type="button"
                data-testid="button-dashboard"
                style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 14px", background: "#222222", color: "#ffffff", border: "none", borderRadius: 8, fontSize: 13, fontWeight: 500, cursor: "pointer", flexShrink: 0, fontFamily: A.font }}
              >
                <LayoutDashboard style={{ width: 14, height: 14 }} />
                Dashboard
              </button>
            </Link>
          )}
        </header>
      )}
      <main style={{ flex: 1, padding: 16 }}>
        {children}
      </main>
    </div>
  );
}
