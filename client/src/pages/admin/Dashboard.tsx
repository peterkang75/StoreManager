import { useQuery } from "@tanstack/react-query";
import { AdminLayout } from "@/components/layouts/AdminLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Store, Users, UserCheck, ClipboardList, Smartphone, FileText, CalendarDays, Clock, Wallet, ExternalLink, UserPlus, KeyRound } from "lucide-react";
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
            Welcome to Staff Manager
          </h2>
          <p className="text-muted-foreground">
            매장, 후보자, 직원을 한 곳에서 관리하세요.
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <StatCard
            title="Active Stores"
            value={activeStores}
            icon={Store}
            href="/admin/stores"
            isLoading={storesLoading}
          />
          <StatCard
            title="Pending Candidates"
            value={pendingCandidates}
            icon={Users}
            href="/admin/candidates"
            isLoading={candidatesLoading}
          />
          <StatCard
            title="Active Employees"
            value={activeEmployees}
            icon={UserCheck}
            href="/admin/employees"
            isLoading={employeesLoading}
          />
          <StatCard
            title="Recent Hires"
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
                    <p className="text-sm text-muted-foreground">매장 위치 추가 또는 수정</p>
                  </div>
                </div>
              </Link>
              <Link href="/admin/candidates">
                <div className="flex items-center gap-3 p-3 rounded-md hover-elevate cursor-pointer" data-testid="link-review-candidates">
                  <Users className="h-5 w-5 text-primary" />
                  <div>
                    <p className="font-medium">Review Candidates</p>
                    <p className="text-sm text-muted-foreground">면접 결과 확인 및 처리</p>
                  </div>
                </div>
              </Link>
              <Link href="/admin/employees">
                <div className="flex items-center gap-3 p-3 rounded-md hover-elevate cursor-pointer" data-testid="link-view-employees">
                  <UserCheck className="h-5 w-5 text-primary" />
                  <div>
                    <p className="font-medium">View Employees</p>
                    <p className="text-sm text-muted-foreground">직원 정보 및 상태 관리</p>
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
                    <p className="text-sm text-muted-foreground">현장 후보자 면접</p>
                  </div>
                  <ExternalLink className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                </div>
              </Link>
              <Link href="/m/roster">
                <div className="flex items-center gap-3 p-3 rounded-md hover-elevate cursor-pointer" data-testid="link-mobile-roster">
                  <CalendarDays className="h-5 w-5 text-primary" />
                  <div className="flex-1 min-w-0">
                    <p className="font-medium">Roster View</p>
                    <p className="text-sm text-muted-foreground">직원 근무 일정</p>
                  </div>
                  <ExternalLink className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                </div>
              </Link>
              <Link href="/m/clock">
                <div className="flex items-center gap-3 p-3 rounded-md hover-elevate cursor-pointer" data-testid="link-mobile-clock">
                  <Clock className="h-5 w-5 text-primary" />
                  <div className="flex-1 min-w-0">
                    <p className="font-medium">Clock In/Out</p>
                    <p className="text-sm text-muted-foreground">출퇴근 기록</p>
                  </div>
                  <ExternalLink className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                </div>
              </Link>
              <Link href="/m/daily-close">
                <div className="flex items-center gap-3 p-3 rounded-md hover-elevate cursor-pointer" data-testid="link-mobile-daily-close">
                  <Wallet className="h-5 w-5 text-primary" />
                  <div className="flex-1 min-w-0">
                    <p className="font-medium">Daily Close</p>
                    <p className="text-sm text-muted-foreground">일일 마감 정산</p>
                  </div>
                  <ExternalLink className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                </div>
              </Link>
              <Link href="/m/register">
                <div className="flex items-center gap-3 p-3 rounded-md hover-elevate cursor-pointer" data-testid="link-mobile-register">
                  <UserPlus className="h-5 w-5 text-primary" />
                  <div className="flex-1 min-w-0">
                    <p className="font-medium">Direct Register</p>
                    <p className="text-sm text-muted-foreground">신규 직원 직접 등록</p>
                  </div>
                  <ExternalLink className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                </div>
              </Link>
              <Link href="/m/portal">
                <div className="flex items-center gap-3 p-3 rounded-md hover-elevate cursor-pointer" data-testid="link-mobile-portal">
                  <KeyRound className="h-5 w-5 text-primary" />
                  <div className="flex-1 min-w-0">
                    <p className="font-medium">Employee Portal</p>
                    <p className="text-sm text-muted-foreground">직원 출퇴근 타임시트 입력</p>
                  </div>
                  <ExternalLink className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                </div>
              </Link>
              <div className="p-3 rounded-md bg-muted/50 mt-3">
                <p className="text-sm text-muted-foreground">
                  직원에게 이 링크를 공유하여 모바일로 접근할 수 있습니다. 온보딩 링크는 Candidates 페이지에서 후보자별로 생성됩니다.
                </p>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </AdminLayout>
  );
}
