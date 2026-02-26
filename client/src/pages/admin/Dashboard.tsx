import { useQuery } from "@tanstack/react-query";
import { AdminLayout } from "@/components/layouts/AdminLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Store, Users, UserCheck, ClipboardList, Smartphone, FileText, CalendarDays, Clock, Wallet, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";
import type { Store as StoreType, Candidate, Employee } from "@shared/schema";

function StatCard({ 
  title, 
  value, 
  icon: Icon, 
  href, 
  isLoading 
}: { 
  title: string; 
  value: number | string; 
  icon: React.ElementType; 
  href: string;
  isLoading?: boolean;
}) {
  return (
    <Link href={href}>
      <Card className="hover-elevate cursor-pointer transition-all">
        <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            {title}
          </CardTitle>
          <Icon className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <Skeleton className="h-8 w-16" />
          ) : (
            <div className="text-2xl font-bold" data-testid={`text-stat-${title.toLowerCase().replace(/\s/g, '-')}`}>
              {value}
            </div>
          )}
        </CardContent>
      </Card>
    </Link>
  );
}

export function AdminDashboard() {
  const { data: stores, isLoading: storesLoading } = useQuery<StoreType[]>({
    queryKey: ["/api/stores"],
  });

  const { data: candidates, isLoading: candidatesLoading } = useQuery<Candidate[]>({
    queryKey: ["/api/candidates"],
  });

  const { data: employees, isLoading: employeesLoading } = useQuery<Employee[]>({
    queryKey: ["/api/employees"],
  });

  const activeStores = stores?.filter(s => s.active).length ?? 0;
  const pendingCandidates = candidates?.filter(c => c.hireDecision === "PENDING").length ?? 0;
  const activeEmployees = employees?.filter(e => e.status === "ACTIVE").length ?? 0;
  const recentHires = candidates?.filter(c => c.hireDecision === "HIRE").length ?? 0;

  return (
    <AdminLayout title="Dashboard">
      <div className="space-y-6">
        <div>
          <h2 className="text-2xl font-bold tracking-tight" data-testid="text-welcome">
            직원 관리에 오신 것을 환영합니다
          </h2>
          <p className="text-muted-foreground">
            매장, 후보자, 직원을 한 곳에서 관리하세요.
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <StatCard
            title="활성 매장"
            value={activeStores}
            icon={Store}
            href="/admin/stores"
            isLoading={storesLoading}
          />
          <StatCard
            title="대기 후보자"
            value={pendingCandidates}
            icon={Users}
            href="/admin/candidates"
            isLoading={candidatesLoading}
          />
          <StatCard
            title="활성 직원"
            value={activeEmployees}
            icon={UserCheck}
            href="/admin/employees"
            isLoading={employeesLoading}
          />
          <StatCard
            title="최근 채용"
            value={recentHires}
            icon={ClipboardList}
            href="/admin/candidates"
            isLoading={candidatesLoading}
          />
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Quick Actions</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <Link href="/admin/stores">
                <div className="flex items-center gap-3 p-3 rounded-md hover-elevate cursor-pointer" data-testid="link-manage-stores">
                  <Store className="h-5 w-5 text-primary" />
                  <div>
                    <p className="font-medium">Manage Stores</p>
                    <p className="text-sm text-muted-foreground">Add or edit store locations</p>
                  </div>
                </div>
              </Link>
              <Link href="/admin/candidates">
                <div className="flex items-center gap-3 p-3 rounded-md hover-elevate cursor-pointer" data-testid="link-review-candidates">
                  <Users className="h-5 w-5 text-primary" />
                  <div>
                    <p className="font-medium">Review Candidates</p>
                    <p className="text-sm text-muted-foreground">View and process interview results</p>
                  </div>
                </div>
              </Link>
              <Link href="/admin/employees">
                <div className="flex items-center gap-3 p-3 rounded-md hover-elevate cursor-pointer" data-testid="link-view-employees">
                  <UserCheck className="h-5 w-5 text-primary" />
                  <div>
                    <p className="font-medium">View Employees</p>
                    <p className="text-sm text-muted-foreground">Manage employee details and status</p>
                  </div>
                </div>
              </Link>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <Smartphone className="h-4 w-4" />
                Mobile Forms
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <Link href="/m/interview">
                <div className="flex items-center gap-3 p-3 rounded-md hover-elevate cursor-pointer" data-testid="link-mobile-interview">
                  <ClipboardList className="h-5 w-5 text-primary" />
                  <div className="flex-1 min-w-0">
                    <p className="font-medium">Interview Form</p>
                    <p className="text-sm text-muted-foreground">On-site candidate interviews</p>
                  </div>
                  <ExternalLink className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                </div>
              </Link>
              <Link href="/m/roster">
                <div className="flex items-center gap-3 p-3 rounded-md hover-elevate cursor-pointer" data-testid="link-mobile-roster">
                  <CalendarDays className="h-5 w-5 text-primary" />
                  <div className="flex-1 min-w-0">
                    <p className="font-medium">Roster View</p>
                    <p className="text-sm text-muted-foreground">Staff shift schedule</p>
                  </div>
                  <ExternalLink className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                </div>
              </Link>
              <Link href="/m/clock">
                <div className="flex items-center gap-3 p-3 rounded-md hover-elevate cursor-pointer" data-testid="link-mobile-clock">
                  <Clock className="h-5 w-5 text-primary" />
                  <div className="flex-1 min-w-0">
                    <p className="font-medium">Clock In/Out</p>
                    <p className="text-sm text-muted-foreground">Attendance tracking</p>
                  </div>
                  <ExternalLink className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                </div>
              </Link>
              <Link href="/m/daily-close">
                <div className="flex items-center gap-3 p-3 rounded-md hover-elevate cursor-pointer" data-testid="link-mobile-daily-close">
                  <Wallet className="h-5 w-5 text-primary" />
                  <div className="flex-1 min-w-0">
                    <p className="font-medium">Daily Close</p>
                    <p className="text-sm text-muted-foreground">End-of-day cash reconciliation</p>
                  </div>
                  <ExternalLink className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                </div>
              </Link>
              <div className="p-3 rounded-md bg-muted/50 mt-3">
                <p className="text-sm text-muted-foreground">
                  Share these links with staff for mobile access. Onboarding links are generated per candidate from the Candidates page.
                </p>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </AdminLayout>
  );
}
