import { Route, Routes } from "react-router";

import { AppLayout } from "@/components/app-layout";
import { RequireStage, StageRedirect } from "@/components/route-guard";
import { BudgetsPage } from "@/pages/budgets";
import { DashboardPage } from "@/pages/dashboard";
import { LoginPage } from "@/pages/login";
import { OnboardingPage } from "@/pages/onboarding";
import { SettingsPage } from "@/pages/settings";
import { SetupPage } from "@/pages/setup";
import { TransactionsPage } from "@/pages/transactions";

/**
 * Every route sits under a `RequireStage`, so a URL typed by hand can never show a
 * page the installation is not ready for (see src/hooks/use-stage.ts).
 */
export function App() {
  return (
    <Routes>
      <Route element={<RequireStage allow={["setup"]} />}>
        <Route path="/setup" element={<SetupPage />} />
      </Route>
      <Route element={<RequireStage allow={["login"]} />}>
        <Route path="/login" element={<LoginPage />} />
      </Route>
      {/* Stays open in the `app` stage: the user may add more categories before leaving. */}
      <Route element={<RequireStage allow={["onboarding", "app"]} />}>
        <Route path="/onboarding" element={<OnboardingPage />} />
      </Route>
      <Route element={<RequireStage allow={["app"]} />}>
        <Route element={<AppLayout />}>
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/transactions" element={<TransactionsPage />} />
          <Route path="/budgets" element={<BudgetsPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Route>
      </Route>
      <Route path="*" element={<StageRedirect />} />
    </Routes>
  );
}
