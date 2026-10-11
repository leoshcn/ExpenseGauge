import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { cn } from "cn";
import { CheckIcon, PlusIcon, XIcon } from "lucide-react";
import { useId, useState } from "react";
import { useNavigate } from "react-router";

import { errorMessage, type Schemas } from "@/api/client";
import {
  budgetAccountsQuery,
  categoriesQuery,
  channelsQuery,
  createBudgetAccount,
  createCategory,
  createChannel,
  keys,
  settingsQuery,
  updateSettings,
} from "@/api/queries";
import { AuthLayout } from "@/components/auth-layout";
import { BudgetAccountPicker } from "@/components/budget-account-select";
import { CurrencySelect } from "@/components/currency-select";
import { ErrorState } from "@/components/error-state";
import { FormError, FormField } from "@/components/form-field";
import { NameDialog } from "@/components/name-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { hasUsableCategory, missingStep, STAGE_HOME } from "@/hooks/use-stage";
import { DEFAULT_CURRENCY } from "@/lib/currency";
import { S } from "@/strings.zh";

const T = S.onboarding;
type Step = 1 | 2 | 3;

function Steps({ current }: { current: Step }) {
  const labels = [T.steps.ledger, T.steps.categories, T.steps.channel];
  return (
    <ol className="mb-5 flex items-center gap-2 text-xs" aria-label={T.stepLabel(current, labels.length)}>
      {labels.map((label, index) => {
        const step = index + 1;
        const done = step < current;
        return (
          <li key={label} className="flex flex-1 items-center gap-2" aria-current={step === current ? "step" : undefined}>
            <span
              className={cn(
                "num flex size-5 shrink-0 items-center justify-center rounded-full border text-[11px] font-medium",
                step === current && "border-primary bg-primary text-primary-foreground",
                done && "border-positive bg-positive-soft text-positive",
                step > current && "text-muted-foreground",
              )}
            >
              {done ? <CheckIcon className="size-3" /> : step}
            </span>
            {/* Only the current step's name fits beside three markers on a phone. */}
            <span className={step === current ? "font-medium" : "text-muted-foreground max-sm:sr-only"}>{label}</span>
            {step < labels.length ? <span className="h-px flex-1 bg-border" /> : null}
          </li>
        );
      })}
    </ol>
  );
}

/** Step 1: the base currency and the first budget account. */
function LedgerStep({
  settings,
  budgetAccounts,
}: {
  settings: Schemas["SettingsOut"];
  budgetAccounts: readonly Schemas["BudgetAccountOut"][];
}) {
  const queryClient = useQueryClient();
  const currencyId = useId();
  const [currency, setCurrency] = useState(settings.currency ?? DEFAULT_CURRENCY);
  const [name, setName] = useState("");
  const [nameError, setNameError] = useState<string>();
  // Only what is still missing is asked for (a reload after a partial failure resumes).
  const needsAccount = budgetAccounts.length === 0;

  const save = useMutation({
    mutationFn: async (input: { currency: string; name: string | null }) => {
      if (input.currency !== settings.currency) await updateSettings({ currency: input.currency });
      if (input.name !== null) await createBudgetAccount({ name: input.name });
    },
    // Also after a failure: the currency may have been saved before the account failed.
    onSettled: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: keys.settings }),
        queryClient.invalidateQueries({ queryKey: keys.budgetAccounts }),
      ]),
  });

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = name.trim();
    if (needsAccount && !trimmed) {
      setNameError(T.ledger.nameRequired);
      return;
    }
    setNameError(undefined);
    save.mutate({ currency, name: needsAccount ? trimmed : null });
  }

  return (
    <AuthLayout title={T.ledger.title} description={T.ledger.description} eyebrow={T.title}>
      <Steps current={1} />
      <form onSubmit={submit} noValidate className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor={currencyId}>{T.ledger.currency}</Label>
          <CurrencySelect id={currencyId} value={currency} onChange={setCurrency} />
          <p className="text-xs text-muted-foreground">{T.ledger.currencyHint}</p>
        </div>
        {needsAccount ? (
          <FormField
            label={T.ledger.name}
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={T.ledger.namePlaceholder}
            error={nameError}
            maxLength={100}
            autoFocus
          />
        ) : null}
        <FormError message={save.isError ? errorMessage(save.error) : null} />
        <Button type="submit" className="w-full" disabled={save.isPending}>
          {save.isPending ? T.ledger.submitting : T.ledger.submit}
        </Button>
      </form>
    </AuthLayout>
  );
}

function ExistingCategories({ tree }: { tree: Schemas["CategoryTree"] }) {
  if (tree.categories.length === 0) return null;
  return (
    <section className="mb-5 space-y-2">
      <h2 className="text-xs font-medium text-muted-foreground">{T.categories.existing}</h2>
      <ul className="space-y-2">
        {tree.categories.map((parent) => (
          <li key={parent.id} className="rounded-lg border bg-muted/40 px-3 py-2">
            <div className="font-medium">{parent.name}</div>
            {parent.children.length > 0 ? (
              <ul className="mt-1.5 flex flex-wrap gap-1.5">
                {parent.children.map((child) => (
                  <li key={child.id} className="rounded-full border bg-card px-2 py-0.5 text-xs">
                    {child.name}
                    <span className="text-muted-foreground"> · {child.budget_account.name}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-0.5 text-xs text-warning-foreground">{T.categories.noChildren}</p>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

type ChildRow = { name: string; budgetAccountId: number };

/** Step 2: level-1 categories with level-2 children, each child in a budget account. */
function CategoryStep({
  budgetAccounts,
  tree,
  onNext,
}: {
  budgetAccounts: readonly Schemas["BudgetAccountOut"][];
  tree: Schemas["CategoryTree"];
  onNext: () => void;
}) {
  const queryClient = useQueryClient();
  // Step 1 guarantees at least one budget account; new rows default to the first.
  const firstAccount = budgetAccounts[0]?.id ?? 0;
  const emptyRow = (): ChildRow => ({ name: "", budgetAccountId: firstAccount });
  const [parent, setParent] = useState("");
  const [children, setChildren] = useState<ChildRow[]>([emptyRow()]);
  const [errors, setErrors] = useState<{ parent?: string; children?: string }>({});
  const [addingAccount, setAddingAccount] = useState(false);

  const add = useMutation({
    mutationFn: async (input: { parent: string; children: ChildRow[] }) => {
      // A level-1 category left without children by an earlier failed attempt is reused,
      // so retrying does not run into CATEGORY_NAME_TAKEN.
      const existing = tree.categories.find((category) => category.name === input.parent);
      const parentId = existing?.id ?? (await createCategory({ name: input.parent })).id;
      for (const child of input.children) {
        await createCategory({ name: child.name, parent_id: parentId, budget_account_id: child.budgetAccountId });
      }
    },
    onSuccess: () => {
      setParent("");
      setChildren([emptyRow()]);
    },
    // Also after a failure: part of the group may have been created.
    onSettled: () => queryClient.invalidateQueries({ queryKey: keys.ledger }),
  });

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const parentName = parent.trim();
    const rows = children
      .map((child) => ({ ...child, name: child.name.trim() }))
      .filter((child) => child.name !== "");
    const found: typeof errors = {};
    if (!parentName) found.parent = T.categories.parentRequired;
    if (rows.length === 0) found.children = T.categories.childRequired;
    else if (new Set(rows.map((row) => row.name)).size !== rows.length) {
      found.children = T.categories.childDuplicate;
    }
    setErrors(found);
    if (Object.keys(found).length === 0) add.mutate({ parent: parentName, children: rows });
  }

  function setRow(index: number, next: Partial<ChildRow>) {
    setChildren(children.map((row, i) => (i === index ? { ...row, ...next } : row)));
  }

  const usable = hasUsableCategory(tree);

  return (
    <AuthLayout title={T.categories.title} description={T.categories.description} eyebrow={T.title}>
      <Steps current={2} />
      <ExistingCategories tree={tree} />
      <form onSubmit={submit} noValidate className="space-y-4">
        <FormField
          label={T.categories.parent}
          value={parent}
          onChange={(event) => setParent(event.target.value)}
          placeholder={T.categories.parentPlaceholder}
          error={errors.parent}
          maxLength={100}
        />
        <fieldset className="space-y-1.5">
          <legend className="mb-1.5 flex w-full items-center justify-between text-sm leading-none font-medium">
            <span>{T.categories.children}</span>
            <span className="text-xs font-normal text-muted-foreground">{T.categories.budgetAccount}</span>
          </legend>
          {children.map((child, index) => (
            <div key={index} className="flex gap-2">
              <Input
                value={child.name}
                onChange={(event) => setRow(index, { name: event.target.value })}
                placeholder={T.categories.childPlaceholder}
                aria-label={`${T.categories.children} ${index + 1}`}
                aria-invalid={errors.children ? true : undefined}
                maxLength={100}
                className="min-w-0 flex-1"
              />
              <BudgetAccountPicker
                budgetAccounts={budgetAccounts}
                value={child.budgetAccountId}
                onChange={(id) => setRow(index, { budgetAccountId: id })}
                label={T.categories.budgetAccountOf(index + 1)}
                className="w-28 shrink-0 sm:w-36"
              />
              {children.length > 1 ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => setChildren(children.filter((_, i) => i !== index))}
                  aria-label={T.categories.removeChild(index + 1)}
                >
                  <XIcon />
                </Button>
              ) : null}
            </div>
          ))}
          {errors.children ? <p className="text-xs text-over">{errors.children}</p> : null}
          <div className="flex flex-wrap justify-between gap-x-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="-ml-2 text-muted-foreground"
              onClick={() => setChildren([...children, emptyRow()])}
            >
              <PlusIcon />
              {T.categories.addChild}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="-mr-2 text-muted-foreground"
              onClick={() => setAddingAccount(true)}
            >
              <PlusIcon />
              {T.categories.addBudgetAccount}
            </Button>
          </div>
        </fieldset>
        <FormError message={add.isError ? errorMessage(add.error) : null} />
        <Button
          type="submit"
          variant={usable ? "outline" : "default"}
          className="w-full"
          disabled={add.isPending}
        >
          {add.isPending ? T.categories.submitting : T.categories.submit}
        </Button>
      </form>
      <div className="mt-5 space-y-2 border-t pt-5">
        <Button className="w-full" disabled={!usable} onClick={onNext}>
          {T.next}
        </Button>
        <p className="text-center text-xs text-muted-foreground">{T.categories.nextHint}</p>
        <p className="text-center text-xs text-muted-foreground">{T.categories.descriptionHint}</p>
      </div>
      {addingAccount ? (
        <NameDialog
          title={T.categories.addBudgetAccountTitle}
          label={S.settings.budgetAccounts.name}
          placeholder={S.settings.budgetAccounts.namePlaceholder}
          submitLabel={S.settings.budgetAccounts.create}
          pendingLabel={S.settings.budgetAccounts.creating}
          onSubmit={async (name) => {
            await createBudgetAccount({ name });
            await queryClient.invalidateQueries({ queryKey: keys.budgetAccounts });
          }}
          onClose={() => setAddingAccount(false)}
        />
      ) : null}
    </AuthLayout>
  );
}

/** Step 3: the first payment channel, then on to the app. */
function ChannelStep({ channels, onBack }: { channels: readonly Schemas["ChannelOut"][]; onBack: () => void }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [nameError, setNameError] = useState<string>();

  const create = useMutation({
    mutationFn: createChannel,
    onSuccess: async () => {
      setName("");
      await queryClient.invalidateQueries({ queryKey: keys.channels });
    },
  });

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = name.trim();
    setNameError(trimmed ? undefined : S.common.nameRequired);
    if (trimmed) create.mutate({ name: trimmed });
  }

  const ready = channels.length > 0;

  return (
    <AuthLayout title={T.channel.title} description={T.channel.description} eyebrow={T.title}>
      <Steps current={3} />
      {ready ? (
        <section className="mb-5 space-y-2">
          <h2 className="text-xs font-medium text-muted-foreground">{T.channel.existing}</h2>
          <ul className="divide-y rounded-lg border bg-muted/40">
            {channels.map((channel) => (
              <li key={channel.id} className="flex items-center justify-between gap-3 px-3 py-2">
                <span className="min-w-0 truncate">{channel.name}</span>
                <span className="num text-xs text-muted-foreground">{T.channel.id(channel.id)}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <form onSubmit={submit} noValidate className="space-y-4">
        <FormField
          label={T.channel.name}
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder={T.channel.namePlaceholder}
          error={nameError}
          maxLength={100}
          autoFocus
        />
        <FormError message={create.isError ? errorMessage(create.error) : null} />
        <Button
          type="submit"
          variant={ready ? "outline" : "default"}
          className="w-full"
          disabled={create.isPending}
        >
          {create.isPending ? T.channel.submitting : T.channel.submit}
        </Button>
      </form>
      <div className="mt-5 space-y-2 border-t pt-5">
        <Button className="w-full" disabled={!ready} onClick={() => void navigate(STAGE_HOME.app)}>
          {T.channel.finish}
        </Button>
        <p className="text-center text-xs text-muted-foreground">{T.channel.finishHint}</p>
        <Button variant="ghost" size="sm" className="w-full text-muted-foreground" onClick={onBack}>
          {S.common.back}
        </Button>
      </div>
    </AuthLayout>
  );
}

/**
 * Base currency and first budget account, then categories, then the first payment
 * channel. The step is derived from what exists on the server, so reloading or coming
 * back later resumes where the user left off. The categories step stays on screen once
 * its first group exists, so more can be added, until the user moves on.
 */
export function OnboardingPage() {
  const settings = useQuery(settingsQuery);
  const budgetAccounts = useQuery(budgetAccountsQuery);
  const tree = useQuery(categoriesQuery());
  const channels = useQuery(channelsQuery);
  const [chosen, setChosen] = useState<2 | 3 | null>(null);

  const queries = [settings, budgetAccounts, tree, channels];
  const failed = queries.find((query) => query.isLoadingError);
  if (failed) {
    return (
      <AuthLayout title={T.title}>
        <ErrorState
          className="border-0 py-6 shadow-none"
          title={S.errors.loadFailedTitle}
          error={failed.error}
          onRetry={() => void failed.refetch()}
        />
      </AuthLayout>
    );
  }
  if (!settings.data || !budgetAccounts.data || !tree.data || !channels.data) {
    return (
      <AuthLayout title={T.title}>
        <Skeleton role="status" aria-label={S.common.loading} className="h-64 w-full" />
      </AuthLayout>
    );
  }

  const missing = missingStep(settings.data, budgetAccounts.data, tree.data, channels.data);
  // Remember that the categories step was reached, so adding its first group does not
  // jump ahead to the channel step (state set during render: React re-renders at once).
  if (missing === 2 && chosen !== 2) setChosen(2);
  const step: Step = missing === 1 ? 1 : missing === 2 ? 2 : (chosen ?? 3);

  if (step === 1) return <LedgerStep settings={settings.data} budgetAccounts={budgetAccounts.data} />;
  if (step === 2) {
    return <CategoryStep budgetAccounts={budgetAccounts.data} tree={tree.data} onNext={() => setChosen(3)} />;
  }
  return <ChannelStep channels={channels.data} onBack={() => setChosen(2)} />;
}
