import { Link } from "wouter";
import {
  Store,
  Users,
  UserCheck,
  Calendar,
  Clock,
  DollarSign,
  Wallet,
  Truck,
  FileText,
  ArrowLeftRight,
  ClipboardCheck,
  History,
  CreditCard,
  Megaphone,
  BrainCircuit,
  Package,
  Building2,
  Repeat,
  ShieldCheck,
  LayoutDashboard,
  type LucideIcon,
} from "lucide-react";
import { AdminLayout } from "@/components/layouts/AdminLayout";
import { Card } from "@/components/ui/card";
import { useAdminRole } from "@/contexts/AdminRoleContext";

type ManagerShortcut = { title: string; url: string; icon: LucideIcon };

// Mirrors AdminLayout's sidebar nav — kept in sync so the shortcut grid
// reflects exactly what Access Control exposes to the MANAGER role.
const MANAGER_SHORTCUTS: ManagerShortcut[] = [
  { title: "Rosters",            url: "/admin/rosters",          icon: Calendar },
  { title: "Pending Approvals",  url: "/admin/approvals",        icon: ClipboardCheck },
  { title: "Attendance History", url: "/admin/timesheets",       icon: History },
  { title: "Payroll",            url: "/admin/payrolls",         icon: DollarSign },
  { title: "Storage",            url: "/admin/storage",          icon: Package },
  { title: "Accounts Payable",   url: "/admin/accounts-payable", icon: CreditCard },
  { title: "Cash Flow",          url: "/admin/finance",          icon: ArrowLeftRight },
  { title: "Cash & Close",       url: "/admin/cash",             icon: Wallet },
  { title: "Suppliers",          url: "/admin/suppliers",        icon: Truck },
  { title: "Invoices",           url: "/admin/suppliers/invoices", icon: FileText },
  { title: "Employees",          url: "/admin/employees",        icon: UserCheck },
  { title: "Candidates",         url: "/admin/candidates",       icon: Users },
  { title: "Stores",             url: "/admin/stores",           icon: Store },
  { title: "Notices",            url: "/admin/notices",          icon: Megaphone },
  { title: "AI Smart Inbox",     url: "/admin/executive",        icon: BrainCircuit },
];

export function ManagerDashboard() {
  const { hasAccess } = useAdminRole();

  const visible = MANAGER_SHORTCUTS.filter((item) => hasAccess(item.url));

  return (
    <AdminLayout title="Dashboard">
      <div className="max-w-md mx-auto w-full">
        <div className="mb-4">
          <h2 className="text-xl font-semibold tracking-tight">Quick Access</h2>
          <p className="text-sm text-muted-foreground">
            권한이 허용된 기능으로 바로 이동합니다.
          </p>
        </div>

        {visible.length === 0 ? (
          <Card className="p-6 text-center text-sm text-muted-foreground" data-testid="manager-no-access">
            <ShieldCheck className="w-6 h-6 mx-auto mb-2 text-muted-foreground/70" />
            접근 가능한 기능이 없습니다. 관리자에게 문의하세요.
          </Card>
        ) : (
          <div className="grid grid-cols-2 gap-3" data-testid="grid-manager-shortcuts">
            {visible.map((item) => {
              const Icon = item.icon;
              return (
                <Link
                  key={item.url}
                  href={item.url}
                  data-testid={`shortcut-${item.title.toLowerCase().replace(/\s+/g, "-")}`}
                >
                  <Card className="aspect-square flex flex-col items-center justify-center gap-3 p-4 cursor-pointer hover-elevate active-elevate-2 transition-all">
                    <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center">
                      <Icon className="w-6 h-6 text-primary" />
                    </div>
                    <span className="text-sm font-medium text-center leading-tight">
                      {item.title}
                    </span>
                  </Card>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </AdminLayout>
  );
}
