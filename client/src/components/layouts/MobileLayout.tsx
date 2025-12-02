import { ArrowLeft } from "lucide-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";

interface MobileLayoutProps {
  children: React.ReactNode;
  title?: string;
  backUrl?: string;
  showHeader?: boolean;
}

export function MobileLayout({ 
  children, 
  title, 
  backUrl, 
  showHeader = true 
}: MobileLayoutProps) {
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
            <h1 className="text-lg font-semibold truncate" data-testid="text-mobile-title">
              {title}
            </h1>
          )}
        </header>
      )}
      <main className="flex-1 p-4">
        {children}
      </main>
    </div>
  );
}
