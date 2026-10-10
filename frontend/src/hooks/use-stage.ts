import { useQueries, useQuery } from "@tanstack/react-query";

import { accountsQuery, categoriesQuery, meQuery, setupStatusQuery } from "@/api/queries";
import type { Schemas } from "@/api/client";

/** How far the installation has come; each stage has exactly one home route. */
export type Stage = "setup" | "login" | "onboarding" | "app";

export const STAGE_HOME: Record<Stage, string> = {
  setup: "/setup",
  login: "/login",
  onboarding: "/onboarding",
  app: "/dashboard",
};

/** A level-1 category is usable once it has a level-2 child (parent PRD R5). */
export function hasUsableCategory(tree: Schemas["CategoryTree"]): boolean {
  return tree.categories.some((parent) => parent.children.length > 0);
}

export type StageState =
  | { status: "loading" }
  | { status: "error"; error: unknown; retry: () => void }
  | { status: "ready"; stage: Stage };

/** The parts of a query result the stage depends on. */
type StepQuery<T> = {
  data: T | undefined;
  isLoadingError: boolean;
  error: unknown;
  refetch: () => unknown;
};

export type StageInputs = {
  setup: StepQuery<Schemas["SetupStatus"]>;
  me: StepQuery<Schemas["UserOut"] | null>;
  accounts: StepQuery<Schemas["AccountOut"][]>;
  trees: readonly StepQuery<Schemas["CategoryTree"]>[];
};

function failure(query: StepQuery<unknown>): StageState {
  return { status: "error", error: query.error, retry: () => void query.refetch() };
}

/**
 * The stage, decided one step at a time: a step is consulted only once every step before
 * it has an answer, so a failure left behind by a later query (for example `accounts`
 * after the session ended and `me` went null) never hides the stage an earlier step
 * decides. Only a failed first load blocks the app; a failed background refetch keeps
 * the cached data. Pure, unit-tested in use-stage.test.ts.
 */
export function resolveStage({ setup, me, accounts, trees }: StageInputs): StageState {
  if (setup.isLoadingError) return failure(setup);
  if (setup.data === undefined) return { status: "loading" };
  if (!setup.data.user_exists) return { status: "ready", stage: "setup" };

  if (me.isLoadingError) return failure(me);
  if (me.data === undefined) return { status: "loading" };
  if (me.data === null) return { status: "ready", stage: "login" };

  if (accounts.isLoadingError) return failure(accounts);
  if (accounts.data === undefined) return { status: "loading" };
  if (accounts.data.length === 0) return { status: "ready", stage: "onboarding" };

  // One account with a usable category is enough, whatever state the others are in.
  if (trees.some((tree) => tree.data && hasUsableCategory(tree.data))) {
    return { status: "ready", stage: "app" };
  }
  const failed = trees.find((tree) => tree.isLoadingError);
  if (failed) return failure(failed);
  if (trees.some((tree) => tree.data === undefined)) return { status: "loading" };
  return { status: "ready", stage: "onboarding" };
}

/**
 * setup (no user) -> login (no session) -> onboarding (no account, or no account with a
 * usable category) -> app. Each query waits for the one before it.
 */
export function useStage(): StageState {
  const setup = useQuery(setupStatusQuery);
  const userExists = setup.data?.user_exists === true;
  const me = useQuery({ ...meQuery, enabled: userExists });
  const signedIn = userExists && me.data != null;
  const accounts = useQuery({ ...accountsQuery, enabled: signedIn });
  const trees = useQueries({
    queries: (signedIn ? (accounts.data ?? []) : []).map((account) => categoriesQuery(account.id)),
  });
  return resolveStage({ setup, me, accounts, trees });
}
