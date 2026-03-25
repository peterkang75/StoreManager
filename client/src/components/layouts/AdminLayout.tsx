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
  ChefHat,
} from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";

const hiringNavItems = [
  { title: "Dashboard",  url: "/admin",            icon: LayoutDashboard },
  { title: "Stores",     url: "/admin/stores",     icon: Store },
  { title: "Candidates", url: "/admin/candidates", icon: Users },
  { title: "Employees",  url: "/admin/employees",  icon: UserCheck },
];

const operationsNavItems = [
  { title: "Rosters",            url: "/admin/rosters",   icon: Calendar },
  { title: "Pending Approvals",  url: "/admin/approvals", icon: ClipboardCheck },
  { title: "Attendance History", url: "/admin/timesheets",icon: History },
  { title: "Payroll",            url: "/admin/payrolls",  icon: DollarSign },
];

const commsNavItems = [
  { title: "Notices", url: "/admin/notices", icon: Megaphone },
];

const financeNavItems = [
  { title: "Cash Flow",       url: "/admin/finance",           icon: ArrowLeftRight },
  { title: "Cash & Close",    url: "/admin/cash",              icon: Wallet },
  { title: "Suppliers",       url: "/admin/suppliers",         icon: Truck },
  { title: "Invoices",        url: "/admin/suppliers/invoices",icon: FileText },
  { title: "Accounts Payable",url: "/admin/accounts-payable",  icon: CreditCard },
];

interface AdminLayoutProps {
  children: React.ReactNode;
  title?: string;
}

function NavGroup({
  label,
  items,
  isActive,
}: {
  label: string;
  items: { title: string; url: string; icon: React.ElementType }[];
  isActive: (url: string) => boolean;
}) {
  return (
    <SidebarGroup>
      <SidebarGroupLabel className="text-[10px] font-bold uppercase tracking-widest text-sidebar-foreground/40 px-3 pt-3 pb-1">
        {label}
      </SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          {items.map((item) => (
            <SidebarMenuItem key={item.title}>
              <SidebarMenuButton
                asChild
                isActive={isActive(item.url)}
                tooltip={item.title}
                className="text-sidebar-foreground/75 hover:text-sidebar-foreground data-[active=true]:text-sidebar-primary-foreground data-[active=true]:bg-sidebar-primary data-[active=true]:font-semibold"
              >
                <Link
                  href={item.url}
                  data-testid={`link-admin-${item.title.toLowerCase().replace(/\s+/g, '-')}`}
                >
                  <item.icon className="w-4 h-4 shrink-0" />
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

function AdminSidebar() {
  const [location] = useLocation();

  const isActive = (url: string) => {
    if (url === "/admin") return location === url;
    return location === url || location.startsWith(url + "/");
  };

  return (
    <Sidebar collapsible="icon">
      {/* Brand Header */}
      <SidebarHeader className="px-4 py-4 border-b border-sidebar-border">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-sidebar-primary flex items-center justify-center shrink-0 shadow-sm">
            <ChefHat className="w-4 h-4 text-white" />
          </div>
          <div className="flex flex-col group-data-[collapsible=icon]:hidden min-w-0">
            <span className="text-sm font-bold text-sidebar-foreground tracking-tight leading-none">
              Staff Manager
            </span>
            <span className="text-[10px] text-sidebar-foreground/50 uppercase tracking-widest mt-0.5">
              Admin Portal
            </span>
          </div>
        </div>
      </SidebarHeader>

      <SidebarContent className="py-2">
        <NavGroup label="Hiring"         items={hiringNavItems}     isActive={isActive} />
        <NavGroup label="Operations"     items={operationsNavItems} isActive={isActive} />
        <NavGroup label="Finance"        items={financeNavItems}    isActive={isActive} />
        <NavGroup label="Communications" items={commsNavItems}      isActive={isActive} />
      </SidebarContent>
    </Sidebar>
  );
}

export function AdminLayout({ children, title }: AdminLayoutProps) {
  const style = {
    "--sidebar-width": "16rem",
    "--sidebar-width-icon": "3.25rem",
  };

  return (
    <SidebarProvider style={style as React.CSSProperties}>
      <div className="flex h-screen w-full">
        <AdminSidebar />
        <div className="flex flex-col flex-1 min-w-0">
          {/* Top header bar */}
          <header className="h-14 flex items-center gap-3 px-4 border-b border-border bg-background/80 backdrop-blur-sm sticky top-0 z-40 shrink-0 shadow-sm">
            <SidebarTrigger
              data-testid="button-sidebar-toggle"
              className="text-foreground/60 hover:text-foreground"
            />
            {title && (
              <div className="flex items-center gap-2 min-w-0">
                <span className="w-px h-4 bg-border shrink-0" />
                <h1
                  className="text-sm font-semibold text-foreground truncate tracking-tight"
                  data-testid="text-page-title"
                >
                  {title}
                </h1>
              </div>
            )}
          </header>

          {/* Main content area — warm cream canvas */}
          <main className="flex-1 overflow-auto bg-background">
            <div className="p-6 max-w-7xl mx-auto">
              {children}
            </div>
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}
