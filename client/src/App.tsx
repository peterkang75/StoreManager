import { Switch, Route, Redirect } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
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
import { AdminFinance } from "@/pages/admin/Finance";
import { AdminPaySlips } from "@/pages/admin/PaySlips";

import { MobileInterview } from "@/pages/mobile/Interview";
import { MobileOnboarding } from "@/pages/mobile/Onboarding";
import { MobileRoster } from "@/pages/mobile/Roster";
import { MobileClock } from "@/pages/mobile/Clock";
import { MobileDailyClose } from "@/pages/mobile/DailyClose";
import { MobileDirectRegister } from "@/pages/mobile/DirectRegister";
import { EmployeePortal } from "@/pages/mobile/EmployeePortal";

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
      <Route path="/admin/payrolls" component={AdminPayrolls} />
      <Route path="/admin/payslips" component={AdminPaySlips} />
      <Route path="/admin/cash" component={AdminCash} />
      <Route path="/admin/suppliers" component={AdminSuppliers} />
      <Route path="/admin/suppliers/invoices" component={AdminSupplierInvoices} />
      <Route path="/admin/finance" component={AdminFinance} />
      
      <Route path="/m/interview" component={MobileInterview} />
      <Route path="/m/onboarding/:token" component={MobileOnboarding} />
      <Route path="/m/roster" component={MobileRoster} />
      <Route path="/m/clock" component={MobileClock} />
      <Route path="/m/daily-close" component={MobileDailyClose} />
      <Route path="/m/register" component={MobileDirectRegister} />
      <Route path="/m/portal" component={EmployeePortal} />
      
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Router />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
