import { Switch, Route, Redirect } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AdminRoleProvider } from "@/contexts/AdminRoleContext";
import NotFound from "@/pages/not-found";

import { AdminDashboard } from "@/pages/admin/Dashboard";
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

function Router() {
  return (
    <Switch>
      <Route path="/">
        <Redirect to="/admin" />
      </Route>
      
      <Route path="/admin" component={AdminDashboard} />
      <Route path="/admin/stores" component={AdminStores} />
      <Route path="/admin/candidates" component={AdminCandidates} />
      <Route path="/admin/employees" component={AdminEmployees} />
      <Route path="/admin/employees/:id" component={AdminEmployeeDetail} />
      <Route path="/admin/rosters" component={AdminRosters} />
      <Route path="/admin/timesheets" component={AdminTimesheets} />
      <Route path="/admin/approvals" component={AdminTimesheetApprovals} />
      <Route path="/admin/weekly-payroll" component={AdminWeeklyPayroll} />
      <Route path="/admin/payrolls" component={AdminPayrolls} />
      <Route path="/admin/payslips" component={AdminPaySlips} />
      <Route path="/admin/cash" component={AdminCash} />
      <Route path="/admin/suppliers" component={AdminSuppliers} />
      <Route path="/admin/suppliers/invoices" component={AdminSupplierInvoices} />
      <Route path="/admin/accounts-payable" component={AdminAccountsPayable} />
      <Route path="/admin/finance" component={AdminFinance} />
      <Route path="/admin/notices" component={AdminNotices} />
      <Route path="/admin/executive" component={AdminExecutiveDashboard} />
      <Route path="/admin/triage-inbox" component={AdminTriageInbox} />
      <Route path="/admin/settings/access-control" component={AdminAccessControl} />
      <Route path="/admin/settings/shift-presets" component={AdminShiftPresets} />
      <Route path="/admin/settings/store-config" component={AdminStoreConfig} />
      <Route path="/admin/automations" component={AdminAutomations} />
      <Route path="/admin/storage" component={StorageInventory} />
      
      <Route path="/m/interview" component={MobileInterview} />
      <Route path="/m/onboarding/:token" component={MobileOnboarding} />
      <Route path="/m/roster" component={MobileRoster} />
      <Route path="/m/clock" component={MobileClock} />
      <Route path="/m/daily-close" component={MobileDailyClose} />
      <Route path="/m/register" component={MobileDirectRegister} />
      <Route path="/m/portal" component={EmployeePortal} />
      <Route path="/m/portal-sample" component={PortalDashboardSample} />
      
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <AdminRoleProvider>
          <Toaster />
          <Router />
        </AdminRoleProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
