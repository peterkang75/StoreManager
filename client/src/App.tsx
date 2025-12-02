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
import { MobileInterview } from "@/pages/mobile/Interview";
import { MobileOnboarding } from "@/pages/mobile/Onboarding";

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
      
      <Route path="/m/interview" component={MobileInterview} />
      <Route path="/m/onboarding/:token" component={MobileOnboarding} />
      
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
