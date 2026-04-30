import { Switch, Route, Redirect } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AdminRoleProvider, useAdminRole } from "@/contexts/AdminRoleContext";
import { AuthProvider } from "@/contexts/AuthContext";
import { RequireAuth } from "@/components/RequireAuth";
import NotFound from "@/pages/not-found";

import { AdminLogin } from "@/pages/admin/Login";
import { AdminDashboard } from "@/pages/admin/Dashboard";
import { ManagerDashboard } from "@/pages/admin/ManagerDashboard";
import { AdminStores } from "@/pages/admin/Stores";
import { AdminCandidates } from "@/pages/admin/Candidates";
import { AdminEmployees } from "@/pages/admin/Employees";
import { AdminEmployeeDetail } from "@/pages/admin/EmployeeDetail";
import { AdminRosters } from "@/pages/admin/Rosters";
import { AdminTimesheets } from "@/pages/admin/Timesheets";
import { AdminPayrolls } from "@/pages/admin/Payrolls";
import { AdminCash } from "@/pages/admin/Cash";
import { AdminSuppliers } from "@/pages/admin/Suppliers";
import { AdminSupplierInvoices } from "@/pages/admin/SupplierInvoices";
import { AdminAccountsPayable } from "@/pages/admin/AccountsPayable";
import { AdminFinance } from "@/pages/admin/Finance";
import { AdminPaySlips } from "@/pages/admin/PaySlips";
import { AdminTimesheetApprovals } from "@/pages/admin/TimesheetApprovals";
import { AdminWeeklyPayroll } from "@/pages/admin/WeeklyPayroll";
import { AdminNotices } from "@/pages/admin/Notices";
import { AdminExecutiveDashboard } from "@/pages/admin/ExecutiveDashboard";
import { AdminAccessControl } from "@/pages/admin/AccessControl";
import { AdminTriageInbox } from "@/pages/admin/TriageInbox";
import { AdminShiftPresets } from "@/pages/admin/ShiftPresets";
import { AdminStoreConfig } from "@/pages/admin/StoreConfig";
import { AdminAutomations } from "@/pages/admin/Automations";
import StorageInventory from "@/pages/admin/StorageInventory";

import { MobileInterview } from "@/pages/mobile/Interview";
import { MobileOnboarding } from "@/pages/mobile/Onboarding";
import { MobileRoster } from "@/pages/mobile/Roster";
import { MobileClock } from "@/pages/mobile/Clock";
import { MobileDailyClose } from "@/pages/mobile/DailyClose";
import { MobileDirectRegister } from "@/pages/mobile/DirectRegister";
import { EmployeePortal } from "@/pages/mobile/EmployeePortal";
import { PortalDashboardSample } from "@/pages/mobile/PortalDashboardSample";
import { PortalDashboardSampleAirbnb } from "@/pages/mobile/PortalDashboardSampleAirbnb";

function DashboardByRole() {
  const { currentRole } = useAdminRole();
  return currentRole === "MANAGER" ? <ManagerDashboard /> : <AdminDashboard />;
}

// Wrap an admin page with RequireAuth (default: any logged-in admin tier).
// Pass `allowed` to restrict to specific roles (e.g., AccessControl is ADMIN-only).
function Admin({ children, allowed }: { children: React.ReactNode; allowed?: string[] }) {
  return <RequireAuth allowed={allowed}>{children}</RequireAuth>;
}

function Router() {
  return (
    <Switch>
      <Route path="/">
        <Redirect to="/admin" />
      </Route>

      {/* Phase B: admin login page (no auth required to view) */}
      <Route path="/admin/login" component={AdminLogin} />

      <Route path="/admin"><Admin><DashboardByRole /></Admin></Route>
      <Route path="/admin/stores"><Admin><AdminStores /></Admin></Route>
      <Route path="/admin/candidates"><Admin><AdminCandidates /></Admin></Route>
      <Route path="/admin/employees"><Admin><AdminEmployees /></Admin></Route>
      <Route path="/admin/employees/:id"><Admin><AdminEmployeeDetail /></Admin></Route>
      <Route path="/admin/rosters"><Admin><AdminRosters /></Admin></Route>
      <Route path="/admin/timesheets"><Admin><AdminTimesheets /></Admin></Route>
      <Route path="/admin/approvals"><Admin><AdminTimesheetApprovals /></Admin></Route>
      <Route path="/admin/weekly-payroll"><Admin><AdminWeeklyPayroll /></Admin></Route>
      <Route path="/admin/payrolls"><Admin><AdminPayrolls /></Admin></Route>
      <Route path="/admin/payslips"><Admin><AdminPaySlips /></Admin></Route>
      <Route path="/admin/cash"><Admin><AdminCash /></Admin></Route>
      <Route path="/admin/suppliers"><Admin><AdminSuppliers /></Admin></Route>
      <Route path="/admin/suppliers/invoices"><Admin><AdminSupplierInvoices /></Admin></Route>
      <Route path="/admin/accounts-payable"><Admin><AdminAccountsPayable /></Admin></Route>
      <Route path="/admin/finance"><Admin><AdminFinance /></Admin></Route>
      <Route path="/admin/notices"><Admin><AdminNotices /></Admin></Route>
      <Route path="/admin/executive"><Admin><AdminExecutiveDashboard /></Admin></Route>
      <Route path="/admin/triage-inbox"><Admin><AdminTriageInbox /></Admin></Route>
      <Route path="/admin/settings/access-control"><Admin allowed={["ADMIN"]}><AdminAccessControl /></Admin></Route>
      <Route path="/admin/settings/shift-presets"><Admin allowed={["ADMIN"]}><AdminShiftPresets /></Admin></Route>
      <Route path="/admin/settings/store-config"><Admin allowed={["ADMIN"]}><AdminStoreConfig /></Admin></Route>
      <Route path="/admin/automations"><Admin allowed={["ADMIN"]}><AdminAutomations /></Admin></Route>
      <Route path="/admin/storage"><Admin><StorageInventory /></Admin></Route>

      <Route path="/m/interview" component={MobileInterview} />
      <Route path="/m/onboarding/:token" component={MobileOnboarding} />
      <Route path="/m/roster" component={MobileRoster} />
      <Route path="/m/clock" component={MobileClock} />
      <Route path="/m/daily-close" component={MobileDailyClose} />
      <Route path="/m/register" component={MobileDirectRegister} />
      <Route path="/m/portal" component={EmployeePortal} />
      <Route path="/m/portal-sample" component={PortalDashboardSample} />
      <Route path="/m/portal-sample-2" component={PortalDashboardSampleAirbnb} />
      
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <AuthProvider>
          <AdminRoleProvider>
            <Toaster />
            <Router />
          </AdminRoleProvider>
        </AuthProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
