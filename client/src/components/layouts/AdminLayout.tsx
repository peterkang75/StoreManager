import { useState } from "react";
import { Link, useLocation } from "wouter";
import { 
  Store, 
  Users, 
  UserCheck, 
  LayoutDashboard,
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
  ShieldCheck,
  ChevronDown,
  ChevronRight,
  Inbox,
  Smartphone,
  Package,
  Settings,
  Building2,
} from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAdminRole, type AdminRole } from "@/contexts/AdminRoleContext";

// ─── Nav item definitions ────────────────────────────────────────────────────

const dashboardNavItem = [
  { title: "Dashboard", url: "/admin", icon: LayoutDashboard },
];

const financeNavItems = [
  { title: "Accounts Payable", url: "/admin/accounts-payable",     icon: CreditCard },
  { title: "Cash Flow",        url: "/admin/finance",              icon: ArrowLeftRight },
  { title: "Cash & Close",     url: "/admin/cash",                 icon: Wallet },
  { title: "Suppliers",        url: "/admin/suppliers",            icon: Truck },
  { title: "Invoices",         url: "/admin/suppliers/invoices",   icon: FileText },
];

const operationsNavItems = [
  { title: "Rosters",           url: "/admin/rosters",   icon: Calendar },
  { title: "Pending Approvals", url: "/admin/approvals", icon: ClipboardCheck },
  { title: "Attendance History",url: "/admin/timesheets",icon: History },
  { title: "Payroll",           url: "/admin/payrolls",  icon: DollarSign },
  { title: "Storage",           url: "/admin/storage",   icon: Package },
];

const hiringNavItems = [
  { title: "Employees",  url: "/admin/employees",    icon: UserCheck },
  { title: "Candidates", url: "/admin/candidates",   icon: Users },
  { title: "Stores",     url: "/admin/stores",       icon: Store },
];

const commsNavItems = [
  { title: "Notices", url: "/admin/notices", icon: Megaphone },
];

const executiveNavItems = [
  { title: "AI Smart Inbox", url: "/admin/executive",   icon: BrainCircuit },
  { title: "Triage Inbox",   url: "/admin/triage-inbox", icon: Inbox },
];

const settingsNavItems = [
  { title: "Access Control", url: "/admin/settings/access-control", icon: ShieldCheck },
  { title: "Shift Presets",  url: "/admin/settings/shift-presets",  icon: Clock },
  { title: "Store Settings", url: "/admin/settings/store-config",   icon: Building2 },
];

const ROLE_LABELS: Record<AdminRole, string> = {
  ADMIN:   "Global Admin",
  MANAGER: "Manager",
  STAFF:   "Staff",
};

// ─── Sidebar component ───────────────────────────────────────────────────────

function AdminSidebar() {
  const [location] = useLocation();
  const { currentRole, setCurrentRole, hasAccess } = useAdminRole();
  const isSettingsActive = location.startsWith("/admin/settings");
  const [settingsOpen, setSettingsOpen] = useState(isSettingsActive);

  const isActive = (url: string) => {
    if (url === "/admin") return location === url;
    return location === url || location.startsWith(url + "/");
  };

  function renderGroup(label: string, items: { title: string; url: string; icon: React.ElementType }[]) {
    const visible = items.filter((item) => hasAccess(item.url));
    if (visible.length === 0) return null;
    return (
      <SidebarGroup>
        {label && <SidebarGroupLabel>{label}</SidebarGroupLabel>}
        <SidebarGroupContent>
          <SidebarMenu>
            {visible.map((item) => (
              <SidebarMenuItem key={item.title}>
                <SidebarMenuButton
                  asChild
                  isActive={isActive(item.url)}
                  tooltip={item.title}
                >
                  <Link href={item.url} data-testid={`link-admin-${item.title.toLowerCase().replace(/\s+/g, "-")}`}>
                    <item.icon className="w-4 h-4" />
                    <span>{item.title}</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>
    );
  }

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="p-4 border-b border-sidebar-border">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-md bg-primary flex items-center justify-center shrink-0">
            <Store className="w-4 h-4 text-primary-foreground" />
          </div>
          <div className="flex flex-col min-w-0 group-data-[collapsible=icon]:hidden">
            <span className="text-sm font-semibold truncate">Staff Manager</span>
            <span className="text-xs text-muted-foreground truncate">Admin Portal</span>
          </div>
        </div>

        {/* Role switcher */}
        <div className="mt-3 group-data-[collapsible=icon]:hidden">
          <Select value={currentRole} onValueChange={(v) => setCurrentRole(v as AdminRole)}>
            <SelectTrigger
              className="h-8 text-xs"
              data-testid="select-admin-role"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ADMIN" data-testid="role-option-admin">
                <span className="text-blue-700 dark:text-blue-400 font-medium">Global Admin</span>
              </SelectItem>
              <SelectItem value="MANAGER" data-testid="role-option-manager">
                <span className="text-purple-700 dark:text-purple-400 font-medium">Manager</span>
              </SelectItem>
              <SelectItem value="STAFF" data-testid="role-option-staff">
                <span className="text-green-700 dark:text-green-400 font-medium">Staff</span>
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
      </SidebarHeader>

      <SidebarContent>
        {renderGroup("", dashboardNavItem)}
        {renderGroup("Finance", financeNavItems)}
        {renderGroup("Operations", operationsNavItems)}
        {renderGroup("Hiring", hiringNavItems)}
        {renderGroup("Communications", commsNavItems)}
        {renderGroup("Executive", executiveNavItems)}
        {/* Settings — collapsible with sub-menu items (ADMIN only) */}
        {currentRole === "ADMIN" && (
          <SidebarGroup>
            <SidebarGroupLabel>System</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                <Collapsible open={settingsOpen} onOpenChange={setSettingsOpen} className="group/collapsible">
                  <SidebarMenuItem>
                    <CollapsibleTrigger asChild>
                      <SidebarMenuButton
                        isActive={isSettingsActive}
                        tooltip="Settings"
                        data-testid="link-admin-settings"
                      >
                        <Settings className="w-4 h-4" />
                        <span>Settings</span>
                        <ChevronRight className="ml-auto w-4 h-4 transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90" />
                      </SidebarMenuButton>
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      <SidebarMenuSub>
                        {settingsNavItems.map((item) => (
                          <SidebarMenuSubItem key={item.title}>
                            <SidebarMenuSubButton
                              asChild
                              isActive={isActive(item.url)}
                            >
                              <Link href={item.url} data-testid={`link-admin-${item.title.toLowerCase().replace(/\s+/g, "-")}`}>
                                <item.icon className="w-3.5 h-3.5" />
                                <span>{item.title}</span>
                              </Link>
                            </SidebarMenuSubButton>
                          </SidebarMenuSubItem>
                        ))}
                      </SidebarMenuSub>
                    </CollapsibleContent>
                  </SidebarMenuItem>
                </Collapsible>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
      </SidebarContent>

      <SidebarFooter className="border-t border-sidebar-border p-2">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              asChild
              tooltip="Employee Portal"
            >
              <Link
                href="/m/portal"
                data-testid="link-admin-employee-portal"
              >
                <Smartphone className="w-4 h-4" />
                <span>Employee Portal</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}

// ─── Layout ──────────────────────────────────────────────────────────────────

interface AdminLayoutProps {
  children: React.ReactNode;
  title?: string;
}

export function AdminLayout({ children, title }: AdminLayoutProps) {
  const { currentRole } = useAdminRole();

  const style = {
    "--sidebar-width": "16rem",
    "--sidebar-width-icon": "3rem",
  };

  const roleColor =
    currentRole === "ADMIN" ? "text-blue-600 dark:text-blue-400"
    : currentRole === "MANAGER" ? "text-purple-600 dark:text-purple-400"
    : "text-green-600 dark:text-green-400";

  return (
    <SidebarProvider style={style as React.CSSProperties}>
      <div className="flex h-screen w-full">
        <AdminSidebar />
        <div className="flex flex-col flex-1 min-w-0">
          <header className="h-14 flex items-center gap-4 px-4 border-b bg-background sticky top-0 z-40">
            <SidebarTrigger data-testid="button-sidebar-toggle" />
            {title && (
              <h1 className="text-lg font-semibold flex-1" data-testid="text-page-title">{title}</h1>
            )}
            <span className={`text-xs font-medium px-2 py-0.5 rounded-full border ${roleColor} border-current/30 bg-current/5`}>
              {ROLE_LABELS[currentRole]}
            </span>
          </header>
          <main className="flex-1 overflow-auto bg-muted/30">
            <div className="p-6 max-w-7xl mx-auto">
              {children}
            </div>
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}
