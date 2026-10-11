import { useQuery } from "@tanstack/react-query";

import {
  budgetAccountsQuery,
  categoriesQuery,
  channelsQuery,
  meQuery,
  settingsQuery,
  setupStatusQuery,
} from "@/api/queries";
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

/**
 * The onboarding step the ledger's data calls for, or `null` once nothing is missing:
 * 1 base currency and a first budget account, 2 a usable category, 3 a payment channel.
 */
export function missingStep(
  settings: Schemas["SettingsOut"],
  budgetAccounts: readonly Schemas["BudgetAccountOut"][],
  tree: Schemas["CategoryTree"],
  channels: readonly Schemas["ChannelOut"][],
): 1 | 2 | 3 | null {
  if (settings.currency === null || budgetAccounts.length === 0) return 1;
  if (!hasUsableCategory(tree)) return 2;
  if (channels.length === 0) return 3;
  return null;
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
  settings: StepQuery<Schemas["SettingsOut"]>;
  budgetAccounts: StepQuery<Schemas["BudgetAccountOut"][]>;
  tree: StepQuery<Schemas["CategoryTree"]>;
  channels: StepQuery<Schemas["ChannelOut"][]>;
};

function failure(query: StepQuery<unknown>): StageState {
  return { status: "error", error: query.error, retry: () => void query.refetch() };
}

/**
 * The stage, decided one step at a time: a step is consulted only once every step before
 * it has an answer, so a failure left behind by a later query (for example `settings`
 * after the session ended and `me` went null) never hides the stage an earlier step
 * decides. Only a failed first load blocks the app; a failed background refetch keeps
 * the cached data. Pure, unit-tested in use-stage.test.ts.
 */
export function resolveStage({ setup, me, settings, budgetAccounts, tree, channels }: StageInputs): StageState {
  if (setup.isLoadingError) return failure(setup);
  if (setup.data === undefined) return { status: "loading" };
  if (!setup.data.user_exists) return { status: "ready", stage: "setup" };

  if (me.isLoadingError) return failure(me);
  if (me.data === undefined) return { status: "loading" };
  if (me.data === null) return { status: "ready", stage: "login" };

  const onboarding: StageState = { status: "ready", stage: "onboarding" };

  // Step 1 of onboarding: base currency and a first budget account.
  if (settings.isLoadingError) return failure(settings);
  if (budgetAccounts.isLoadingError) return failure(budgetAccounts);
  if (settings.data === undefined || budgetAccounts.data === undefined) return { status: "loading" };
  if (settings.data.currency === null || budgetAccounts.data.length === 0) return onboarding;

  // Step 2: a level-1 category with a level-2 child.
  if (tree.isLoadingError) return failure(tree);
  if (tree.data === undefined) return { status: "loading" };
  if (!hasUsableCategory(tree.data)) return onboarding;

  // Step 3: a payment channel.
  if (channels.isLoadingError) return failure(channels);
  if (channels.data === undefined) return { status: "loading" };
  if (channels.data.length === 0) return onboarding;

  return { status: "ready", stage: "app" };
}

/**
 * setup (no user) -> login (no session) -> onboarding (no base currency or budget
 * account, no usable category, or no payment channel) -> app. The ledger queries wait for
 * the session.
 */
export function useStage(): StageState {
  const setup = useQuery(setupStatusQuery);
  const userExists = setup.data?.user_exists === true;
  const me = useQuery({ ...meQuery, enabled: userExists });
  const signedIn = userExists && me.data != null;
  const settings = useQuery({ ...settingsQuery, enabled: signedIn });
  const budgetAccounts = useQuery({ ...budgetAccountsQuery, enabled: signedIn });
  const tree = useQuery({ ...categoriesQuery(), enabled: signedIn });
  const channels = useQuery({ ...channelsQuery, enabled: signedIn });
  return resolveStage({ setup, me, settings, budgetAccounts, tree, channels });
}
