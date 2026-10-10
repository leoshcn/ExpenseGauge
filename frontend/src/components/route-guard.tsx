import { Navigate, Outlet } from "react-router";

import { ErrorState } from "@/components/error-state";
import { LogoMark } from "@/components/logo";
import { STAGE_HOME, type Stage, useStage } from "@/hooks/use-stage";
import { S } from "@/strings.zh";

function FullPage({ children }: { children: React.ReactNode }) {
  return <div className="flex min-h-dvh items-center justify-center p-6">{children}</div>;
}

/**
 * Renders the nested routes only while the installation is in one of `allow`;
 * otherwise redirects to the home route of the stage it is actually in.
 */
export function RequireStage({ allow }: { allow: readonly Stage[] }) {
  const state = useStage();

  if (state.status === "loading") {
    return (
      <FullPage>
        <div role="status" className="flex flex-col items-center gap-3 text-muted-foreground">
          <LogoMark className="size-9 animate-pulse" />
          <span>{S.common.loading}</span>
        </div>
      </FullPage>
    );
  }
  if (state.status === "error") {
    return (
      <FullPage>
        <ErrorState
          className="w-full max-w-md"
          title={S.errors.bootstrapTitle}
          error={state.error}
          onRetry={state.retry}
        />
      </FullPage>
    );
  }
  if (!allow.includes(state.stage)) return <Navigate to={STAGE_HOME[state.stage]} replace />;
  return <Outlet />;
}

/** `/` and unknown paths: go to wherever the current stage lives. */
export function StageRedirect() {
  return <RequireStage allow={[]} />;
}
