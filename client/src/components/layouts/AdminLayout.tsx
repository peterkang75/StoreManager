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
  {
    title: "대시보드",
    url: "/admin",
    icon: LayoutDashboard,
  },
  {
    title: "매장",
    url: "/admin/stores",
    icon: Store,
  },
  {
    title: "후보자",
    url: "/admin/candidates",
    icon: Users,
  },
  {
    title: "직원",
    url: "/admin/employees",
    icon: UserCheck,
  },
];

const operationsNavItems = [
  {
    title: "근무표",
    url: "/admin/rosters",
    icon: Calendar,
  },
  {
    title: "근무시간표",
    url: "/admin/timesheets",
    icon: Clock,
  },
  {
    title: "급여",
    url: "/admin/payrolls",
    icon: DollarSign,
  },
];

const financeNavItems = [
  {
    title: "자금 흐름",
    url: "/admin/finance",
    icon: ArrowLeftRight,
  },
  {
    title: "현금 정산",
    url: "/admin/cash",
    icon: Wallet,
  },
  {
    title: "거래처",
    url: "/admin/suppliers",
    icon: Truck,
  },
  {
    title: "청구서",
    url: "/admin/suppliers/invoices",
    icon: FileText,
  },
];

interface AdminLayoutProps {
  children: React.ReactNode;
  title?: string;
}

function AdminSidebar() {
  const [location] = useLocation();

  const isActive = (url: string) => {
    if (url === "/admin") return location === url;
    return location === url || location.startsWith(url + "/");
  };

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="p-4 border-b border-sidebar-border">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-md bg-primary flex items-center justify-center">
            <Store className="w-4 h-4 text-primary-foreground" />
          </div>
          <div className="flex flex-col group-data-[collapsible=icon]:hidden">
            <span className="text-sm font-semibold">Staff Manager</span>
            <span className="text-xs text-muted-foreground">Admin Portal</span>
          </div>
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>채용</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {hiringNavItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton 
                    asChild 
                    isActive={isActive(item.url)}
                    tooltip={item.title}
                  >
                    <Link href={item.url} data-testid={`link-admin-${item.title.toLowerCase().replace(/\s+/g, '-')}`}>
                      <item.icon className="w-4 h-4" />
                      <span>{item.title}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        <SidebarGroup>
          <SidebarGroupLabel>Operations</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {operationsNavItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton 
                    asChild 
                    isActive={isActive(item.url)}
                    tooltip={item.title}
                  >
                    <Link href={item.url} data-testid={`link-admin-${item.title.toLowerCase().replace(/\s+/g, '-')}`}>
                      <item.icon className="w-4 h-4" />
                      <span>{item.title}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        <SidebarGroup>
          <SidebarGroupLabel>Finance</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {financeNavItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton 
                    asChild 
                    isActive={isActive(item.url)}
                    tooltip={item.title}
                  >
                    <Link href={item.url} data-testid={`link-admin-${item.title.toLowerCase().replace(/\s+/g, '-')}`}>
                      <item.icon className="w-4 h-4" />
                      <span>{item.title}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  );
}

export function AdminLayout({ children, title }: AdminLayoutProps) {
  const style = {
    "--sidebar-width": "16rem",
    "--sidebar-width-icon": "3rem",
  };

  return (
    <SidebarProvider style={style as React.CSSProperties}>
      <div className="flex h-screen w-full">
        <AdminSidebar />
        <div className="flex flex-col flex-1 min-w-0">
          <header className="h-14 flex items-center gap-4 px-4 border-b bg-background sticky top-0 z-40">
            <SidebarTrigger data-testid="button-sidebar-toggle" />
            {title && (
              <h1 className="text-lg font-semibold" data-testid="text-page-title">{title}</h1>
            )}
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
