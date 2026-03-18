import { useQuery } from "@tanstack/react-query";
import { AdminLayout } from "@/components/layouts/AdminLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Store, Users, UserCheck, ClipboardList, Smartphone, ExternalLink, UserPlus, KeyRound, AlertTriangle, ShieldCheck } from "lucide-react";
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

function getVisaDaysLeft(visaExpiry: string | null | undefined): number | null {
  if (!visaExpiry) return null;
  const expiry = new Date(visaExpiry);
  if (isNaN(expiry.getTime())) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.ceil((expiry.getTime() - today.getTime()) / 86400000);
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

  const visaAlerts = (employees ?? [])
    .filter(e => e.status === "ACTIVE" && e.visaType && e.visaType !== "CTZ" && e.visaType !== "PR/CTZ" && e.visaType !== "PR")
    .map(e => ({ employee: e, daysLeft: getVisaDaysLeft(e.visaExpiry) }))
    .filter(({ daysLeft }) => daysLeft !== null && daysLeft <= 60)
    .sort((a, b) => (a.daysLeft ?? 999) - (b.daysLeft ?? 999));

  const urgentAlerts = visaAlerts.filter(({ daysLeft }) => daysLeft !== null && daysLeft <= 14);
  const amberAlerts = visaAlerts.filter(({ daysLeft }) => daysLeft !== null && daysLeft > 14 && daysLeft <= 60);

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
          <StatCard title="Active Stores" value={activeStores} icon={Store} href="/admin/stores" isLoading={storesLoading} />
          <StatCard title="Pending Candidates" value={pendingCandidates} icon={Users} href="/admin/candidates" isLoading={candidatesLoading} />
          <StatCard title="Active Employees" value={activeEmployees} icon={UserCheck} href="/admin/employees" isLoading={employeesLoading} />
          <StatCard title="Recent Hires" value={recentHires} icon={ClipboardList} href="/admin/candidates" isLoading={candidatesLoading} />
        </div>

        {/* Compliance Alert Widget */}
        {!employeesLoading && visaAlerts.length > 0 && (
          <Card className="border-orange-400/50" data-testid="compliance-alert-widget">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-orange-500" />
                Visa Compliance Alerts
                {urgentAlerts.length > 0 && (
                  <Badge className="bg-destructive text-destructive-foreground ml-1" data-testid="badge-urgent-count">
                    {urgentAlerts.length} URGENT
                  </Badge>
                )}
                {amberAlerts.length > 0 && (
                  <Badge className="bg-orange-500 text-white ml-1" data-testid="badge-amber-count">
                    {amberAlerts.length} Expiring Soon
                  </Badge>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {visaAlerts.map(({ employee: emp, daysLeft }) => {
                const isUrgent = daysLeft !== null && daysLeft <= 14;
                const isExpired = daysLeft !== null && daysLeft <= 0;
                return (
                  <Link key={emp.id} href={`/admin/employees/${emp.id}`}>
                    <div
                      className={`flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2.5 hover-elevate cursor-pointer ${
                        isUrgent
                          ? "border-destructive/50 bg-destructive/8"
                          : "border-orange-400/40 bg-orange-400/8"
                      }`}
                      data-testid={`compliance-alert-${emp.id}`}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        {isUrgent ? (
                          <AlertTriangle className="h-4 w-4 text-destructive shrink-0" />
                        ) : (
                          <AlertTriangle className="h-4 w-4 text-orange-500 shrink-0" />
                        )}
                        <div className="min-w-0">
                          <p className={`text-sm font-medium ${isUrgent ? "text-destructive" : "text-orange-700 dark:text-orange-400"}`}>
                            {emp.nickname || emp.firstName} {emp.lastName}
                          </p>
                          <p className="text-xs text-muted-foreground truncate">
                            {emp.visaType}{emp.visaSubclass ? ` (${emp.visaSubclass})` : ""} — Expires: {emp.visaExpiry || "Unknown"}
                          </p>
                        </div>
                      </div>
                      <Badge
                        className={`shrink-0 ${isExpired
                          ? "bg-destructive text-destructive-foreground"
                          : isUrgent
                          ? "bg-destructive/80 text-destructive-foreground"
                          : "bg-orange-500 text-white"}`}
                        data-testid={`badge-visa-status-${emp.id}`}
                      >
                        {isExpired ? "EXPIRED" : `${daysLeft}d left`}
                      </Badge>
                    </div>
                  </Link>
                );
              })}
            </CardContent>
          </Card>
        )}
        {!employeesLoading && visaAlerts.length === 0 && employees && employees.length > 0 && (
          <div className="flex items-center gap-2 rounded-md border border-green-500/30 bg-green-500/8 px-4 py-3" data-testid="compliance-all-clear">
            <ShieldCheck className="h-4 w-4 text-green-600 shrink-0" />
            <p className="text-sm text-green-700 dark:text-green-400">All visa compliance checks clear — no employees expiring within 60 days.</p>
          </div>
        )}

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
