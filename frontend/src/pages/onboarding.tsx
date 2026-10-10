import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { cn } from "cn";
import { CheckIcon, PlusIcon, XIcon } from "lucide-react";
import { useId, useState } from "react";
import { useNavigate } from "react-router";

import { errorMessage, type Schemas } from "@/api/client";
import { accountsQuery, categoriesQuery, createAccount, createCategory, keys } from "@/api/queries";
import { AuthLayout } from "@/components/auth-layout";
import { ErrorState } from "@/components/error-state";
import { FormError, FormField } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { hasUsableCategory, STAGE_HOME } from "@/hooks/use-stage";
import { S } from "@/strings.zh";

type CurrencyCode = keyof typeof S.currencies;
const CURRENCIES = Object.keys(S.currencies) as CurrencyCode[];

function Steps({ current }: { current: 1 | 2 }) {
  const labels = [S.onboarding.steps.account, S.onboarding.steps.categories];
  return (
    <ol className="mb-5 flex items-center gap-2 text-xs" aria-label={S.onboarding.stepLabel(current, 2)}>
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
            <span className={step === current ? "font-medium" : "text-muted-foreground"}>{label}</span>
            {step < labels.length ? <span className="h-px flex-1 bg-border" /> : null}
          </li>
        );
      })}
    </ol>
  );
}

function AccountStep() {
  const queryClient = useQueryClient();
  const currencyId = useId();
  const [name, setName] = useState("");
  const [currency, setCurrency] = useState<CurrencyCode>("CNY");
  const [nameError, setNameError] = useState<string>();

  const create = useMutation({
    mutationFn: createAccount,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: keys.accounts }),
  });

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = name.trim();
    setNameError(trimmed ? undefined : S.onboarding.account.nameRequired);
    if (trimmed) create.mutate({ name: trimmed, currency });
  }

  return (
    <AuthLayout
      title={S.onboarding.account.title}
      description={S.onboarding.account.description}
      eyebrow={S.onboarding.title}
    >
      <Steps current={1} />
      <form onSubmit={submit} noValidate className="space-y-4">
        <FormField
          label={S.onboarding.account.name}
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder={S.onboarding.account.namePlaceholder}
          error={nameError}
          maxLength={100}
          autoFocus
        />
        <div className="space-y-1.5">
          <Label htmlFor={currencyId}>{S.onboarding.account.currency}</Label>
          <Select value={currency} onValueChange={(value) => setCurrency(value as CurrencyCode)}>
            <SelectTrigger id={currencyId} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CURRENCIES.map((code) => (
                <SelectItem key={code} value={code}>
                  <span className="num w-9 text-muted-foreground">{code}</span>
                  {S.currencies[code]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <FormError message={create.isError ? errorMessage(create.error) : null} />
        <Button type="submit" className="w-full" disabled={create.isPending}>
          {create.isPending ? S.onboarding.account.submitting : S.onboarding.account.submit}
        </Button>
      </form>
    </AuthLayout>
  );
}

function ExistingCategories({ tree }: { tree: Schemas["CategoryTree"] }) {
  if (tree.categories.length === 0) return null;
  return (
    <section className="mb-5 space-y-2">
      <h2 className="text-xs font-medium text-muted-foreground">{S.onboarding.categories.existing}</h2>
      <ul className="space-y-2">
        {tree.categories.map((parent) => (
          <li key={parent.id} className="rounded-lg border bg-muted/40 px-3 py-2">
            <div className="font-medium">{parent.name}</div>
            {parent.children.length > 0 ? (
              <ul className="mt-1.5 flex flex-wrap gap-1.5">
                {parent.children.map((child) => (
                  <li key={child.id} className="rounded-full border bg-card px-2 py-0.5 text-xs">
                    {child.name}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-0.5 text-xs text-warning-foreground">{S.onboarding.categories.noChildren}</p>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function CategoryStep({ account }: { account: Schemas["AccountOut"] }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const tree = useQuery(categoriesQuery(account.id));
  const [parent, setParent] = useState("");
  const [children, setChildren] = useState<string[]>([""]);
  const [errors, setErrors] = useState<{ parent?: string; children?: string }>({});

  const add = useMutation({
    mutationFn: async (input: { parent: string; children: string[] }) => {
      // A level-1 category left without children by an earlier failed attempt is reused,
      // so retrying does not run into CATEGORY_NAME_TAKEN.
      const existing = tree.data?.categories.find((category) => category.name === input.parent);
      const parentId = existing?.id ?? (await createCategory(account.id, { name: input.parent })).id;
      for (const name of input.children) {
        await createCategory(account.id, { name, parent_id: parentId });
      }
    },
    onSuccess: () => {
      setParent("");
      setChildren([""]);
    },
    // Also after a failure: part of the group may have been created.
    onSettled: () => queryClient.invalidateQueries({ queryKey: keys.categories(account.id) }),
  });

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const parentName = parent.trim();
    const childNames = children.map((child) => child.trim()).filter(Boolean);
    const found: typeof errors = {};
    if (!parentName) found.parent = S.onboarding.categories.parentRequired;
    if (childNames.length === 0) found.children = S.onboarding.categories.childRequired;
    else if (new Set(childNames).size !== childNames.length) {
      found.children = S.onboarding.categories.childDuplicate;
    }
    setErrors(found);
    if (Object.keys(found).length === 0) add.mutate({ parent: parentName, children: childNames });
  }

  const usable = tree.data ? hasUsableCategory(tree.data) : false;

  return (
    <AuthLayout
      title={S.onboarding.categories.title(account.name)}
      description={S.onboarding.categories.description}
      eyebrow={S.onboarding.title}
    >
      <Steps current={2} />
      {tree.isPending ? (
        <Skeleton className="h-40 w-full" />
      ) : tree.isLoadingError ? (
        <ErrorState
          className="border-0 py-6 shadow-none"
          title={S.errors.loadFailedTitle}
          error={tree.error}
          onRetry={() => void tree.refetch()}
        />
      ) : (
        <>
          {tree.data ? <ExistingCategories tree={tree.data} /> : null}
          <form onSubmit={submit} noValidate className="space-y-4">
            <FormField
              label={S.onboarding.categories.parent}
              value={parent}
              onChange={(event) => setParent(event.target.value)}
              placeholder={S.onboarding.categories.parentPlaceholder}
              error={errors.parent}
              maxLength={100}
            />
            <fieldset className="space-y-1.5">
              <legend className="mb-1.5 text-sm leading-none font-medium">
                {S.onboarding.categories.children}
              </legend>
              {children.map((child, index) => (
                <div key={index} className="flex gap-2">
                  <Input
                    value={child}
                    onChange={(event) =>
                      setChildren(children.map((value, i) => (i === index ? event.target.value : value)))
                    }
                    placeholder={S.onboarding.categories.childPlaceholder}
                    aria-label={`${S.onboarding.categories.children} ${index + 1}`}
                    aria-invalid={errors.children ? true : undefined}
                    maxLength={100}
                  />
                  {children.length > 1 ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => setChildren(children.filter((_, i) => i !== index))}
                      aria-label={S.onboarding.categories.removeChild(index + 1)}
                    >
                      <XIcon />
                    </Button>
                  ) : null}
                </div>
              ))}
              {errors.children ? <p className="text-xs text-over">{errors.children}</p> : null}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="-ml-2 text-muted-foreground"
                onClick={() => setChildren([...children, ""])}
              >
                <PlusIcon />
                {S.onboarding.categories.addChild}
              </Button>
            </fieldset>
            <FormError message={add.isError ? errorMessage(add.error) : null} />
            <Button
              type="submit"
              variant={usable ? "outline" : "default"}
              className="w-full"
              disabled={add.isPending}
            >
              {add.isPending ? S.onboarding.categories.submitting : S.onboarding.categories.submit}
            </Button>
          </form>
          <div className="mt-5 space-y-2 border-t pt-5">
            <Button className="w-full" disabled={!usable} onClick={() => void navigate(STAGE_HOME.app)}>
              {S.onboarding.categories.finish}
            </Button>
            <p className="text-center text-xs text-muted-foreground">{S.onboarding.categories.finishHint}</p>
          </div>
        </>
      )}
    </AuthLayout>
  );
}

/**
 * First account, then its first categories. The step is derived from what exists on the
 * server, so reloading or coming back later resumes where the user left off.
 */
export function OnboardingPage() {
  const accounts = useQuery(accountsQuery);
  const first = accounts.data?.[0];
  return first ? <CategoryStep account={first} /> : <AccountStep />;
}
