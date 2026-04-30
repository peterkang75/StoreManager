import { Link } from "wouter";
import {
  Store,
  Users,
  UserCheck,
  Calendar,
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
  ChevronRight,
  ShieldCheck,
  type LucideIcon,
} from "lucide-react";
import { AdminLayout } from "@/components/layouts/AdminLayout";
import { Card } from "@/components/ui/card";
import { useAdminRole } from "@/contexts/AdminRoleContext";

type ManagerShortcut = {
  title: string;
  url: string;
  icon: LucideIcon;
  description: string;
};

type ShortcutGroup = {
  label: string | null;
  layout: "today" | "grid";
  items: ManagerShortcut[];
};

// Mirrors AdminLayout's sidebar nav — kept in sync so the shortcut grid
// reflects exactly what Access Control exposes to the MANAGER role.
const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    label: "Today",
    layout: "today",
    items: [
      { title: "Pending Approvals", url: "/admin/approvals", icon: ClipboardCheck, description: "Review timesheets waiting for approval" },
      { title: "Rosters", url: "/admin/rosters", icon: Calendar, description: "View and edit weekly shifts" },
    ],
  },
  {
    label: "Operations",
    layout: "grid",
    items: [
      { title: "Attendance History", url: "/admin/timesheets", icon: History, description: "Past clock-ins and timesheets" },
      { title: "Cash & Close", url: "/admin/cash", icon: Wallet, description: "Daily cash and end-of-shift" },
      { title: "Storage", url: "/admin/storage", icon: Package, description: "Track stock and consumption" },
    ],
  },
  {
    label: "People",
    layout: "grid",
    items: [
      { title: "Employees", url: "/admin/employees", icon: UserCheck, description: "Manage team and details" },
      { title: "Candidates", url: "/admin/candidates", icon: Users, description: "Interviews and onboarding" },
      { title: "Stores", url: "/admin/stores", icon: Store, description: "Configure store locations" },
    ],
  },
  {
    label: "Finance",
    layout: "grid",
    items: [
      { title: "Payroll", url: "/admin/payrolls", icon: DollarSign, description: "Process payslips and rates" },
      { title: "Accounts Payable", url: "/admin/accounts-payable", icon: CreditCard, description: "Invoices owed to suppliers" },
      { title: "Cash Flow", url: "/admin/finance", icon: ArrowLeftRight, description: "Daily flows and store transfers" },
      { title: "Suppliers", url: "/admin/suppliers", icon: Truck, description: "Supplier list and contacts" },
      { title: "Invoices", url: "/admin/suppliers/invoices", icon: FileText, description: "All supplier invoices" },
    ],
  },
  {
    label: "Inbox",
    layout: "grid",
    items: [
      { title: "Notices", url: "/admin/notices", icon: Megaphone, description: "Send announcements to staff" },
      { title: "AI Smart Inbox", url: "/admin/executive", icon: BrainCircuit, description: "Mailbox parsing and insights" },
    ],
  },
];

// design.md §6 — three-layer warm shadow used on elevated surfaces.
const WARM_CARD_SHADOW =
  "shadow-[0_0_0_1px_rgba(0,0,0,0.02),0_2px_6px_rgba(0,0,0,0.04),0_4px_8px_rgba(0,0,0,0.1)]";

function shortcutTestId(title: string) {
  return `shortcut-${title.toLowerCase().replace(/\s+/g, "-")}`;
}

function TodayCard({ item }: { item: ManagerShortcut }) {
  const Icon = item.icon;
  return (
    <Link href={item.url} data-testid={shortcutTestId(item.title)}>
      <Card
        className={`rounded-[20px] p-4 flex items-center gap-4 cursor-pointer hover-elevate active-elevate-2 transition-all ${WARM_CARD_SHADOW}`}
      >
        <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center shrink-0">
          <Icon className="w-6 h-6 text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-base font-semibold leading-tight">{item.title}</div>
          <div className="text-sm text-muted-foreground mt-1 leading-snug">
            {item.description}
          </div>
        </div>
        <ChevronRight className="w-5 h-5 text-muted-foreground shrink-0" />
      </Card>
    </Link>
  );
}

function GridCard({ item }: { item: ManagerShortcut }) {
  const Icon = item.icon;
  return (
    <Link href={item.url} data-testid={shortcutTestId(item.title)}>
      <Card
        className={`h-full rounded-[20px] p-4 flex flex-col gap-3 cursor-pointer hover-elevate active-elevate-2 transition-all ${WARM_CARD_SHADOW}`}
      >
        <div className="w-11 h-11 rounded-2xl bg-primary/10 flex items-center justify-center">
          <Icon className="w-5 h-5 text-primary" />
        </div>
        <div className="flex-1">
          <div className="text-sm font-semibold leading-tight">{item.title}</div>
          <div className="text-xs text-muted-foreground mt-1 leading-snug">
            {item.description}
          </div>
        </div>
      </Card>
    </Link>
  );
}

export function ManagerDashboard() {
  const { hasAccess } = useAdminRole();

  const visibleGroups = SHORTCUT_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((item) => hasAccess(item.url)),
  })).filter((group) => group.items.length > 0);

  const totalVisible = visibleGroups.reduce((sum, g) => sum + g.items.length, 0);

  return (
    <AdminLayout title="Dashboard">
      <div className="max-w-md mx-auto w-full">
        <div className="mb-5">
          <h2 className="text-xl font-semibold tracking-tight">Quick Access</h2>
          <p className="text-sm text-muted-foreground">
            Jump straight to any feature you have access to.
          </p>
        </div>

        {totalVisible === 0 ? (
          <Card
            className={`p-6 text-center text-sm text-muted-foreground rounded-[20px] ${WARM_CARD_SHADOW}`}
            data-testid="manager-no-access"
          >
            <ShieldCheck className="w-6 h-6 mx-auto mb-2 text-muted-foreground/70" />
            No accessible features. Please contact your administrator.
          </Card>
        ) : (
          <div className="space-y-6" data-testid="grid-manager-shortcuts">
            {visibleGroups.map((group) => (
              <section key={group.label ?? "default"}>
                {group.label && (
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                    {group.label}
                  </h3>
                )}
                {group.layout === "today" ? (
                  <div className="space-y-3">
                    {group.items.map((item) => (
                      <TodayCard key={item.url} item={item} />
                    ))}
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-3">
                    {group.items.map((item) => (
                      <GridCard key={item.url} item={item} />
                    ))}
                  </div>
                )}
              </section>
            ))}
          </div>
        )}
      </div>
    </AdminLayout>
  );
}
