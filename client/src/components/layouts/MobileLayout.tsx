import { ArrowLeft, LayoutDashboard } from "lucide-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";

interface MobileLayoutProps {
  children: React.ReactNode;
  title?: string;
  backUrl?: string;
  showHeader?: boolean;
}

function loadMobileSession() {
  try {
    const raw = localStorage.getItem("mobile_session");
    if (!raw) return null;
    return JSON.parse(raw) as { role?: string };
  } catch {
    return null;
  }
}

export function MobileLayout({
  children,
  title,
  backUrl,
  showHeader = true,
}: MobileLayoutProps) {
  const session = loadMobileSession();
  const isAdmin = session?.role === "OWNER" || session?.role === "MANAGER";

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {showHeader && (
        <header className="h-14 flex items-center gap-3 px-4 border-b bg-background sticky top-0 z-40">
          {backUrl && (
            <Link href={backUrl}>
              <Button
                variant="ghost"
                size="icon"
                className="shrink-0"
                data-testid="button-back"
              >
                <ArrowLeft className="w-5 h-5" />
              </Button>
            </Link>
          )}
          {title && (
            <h1 className="text-lg font-semibold truncate flex-1" data-testid="text-mobile-title">
              {title}
            </h1>
          )}
          {isAdmin && (
            <Link href="/admin">
              <Button
                variant="outline"
                size="sm"
                className="shrink-0 gap-1.5"
                data-testid="button-dashboard"
              >
                <LayoutDashboard className="w-4 h-4" />
                Dashboard
              </Button>
            </Link>
          )}
        </header>
      )}
      <main className="flex-1 p-4">
        {children}
      </main>
    </div>
  );
}
