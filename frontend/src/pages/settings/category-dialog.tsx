import { useMutation } from "@tanstack/react-query";
import { useId, useState } from "react";

import { errorMessage, type Schemas } from "@/api/client";
import { BudgetAccountPicker } from "@/components/budget-account-select";
import { FormError, FormField } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useRestoreFocus } from "@/hooks/use-restore-focus";
import { S } from "@/strings.zh";

import {
  budgetReset,
  CATEGORY_DESCRIPTION_MAX,
  categoryChanges,
  categoryFields,
  type CategoryFields,
  periodOf,
} from "./model";

const T = S.settings.categories;
const R = T.budgetReset;
const PERIOD_NAMES = S.settings.budgetAccounts.periods;
const NAME_MAX = 100;

/**
 * Adds or edits a level-2 category: its name, the budget account it counts towards, and
 * the optional description the agent reads when classifying. Mounted only while open.
 * Editing submits only the changed fields (`changes`), and closes without a request when
 * nothing changed; adding gets all fields (the budget account defaults to the first).
 */
export function CategoryDialog({
  title,
  initial,
  budgetAccounts,
  placeholder,
  submitLabel,
  pendingLabel,
  onSubmit,
  onClose,
}: {
  title: string;
  /** The category being edited; absent when adding. */
  initial?: CategoryFields;
  budgetAccounts: readonly Schemas["BudgetAccountOut"][];
  placeholder?: string;
  submitLabel: string;
  pendingLabel: string;
  onSubmit: (fields: CategoryFields, changes: Schemas["CategoryUpdateIn"]) => Promise<unknown>;
  onClose: () => void;
}) {
  useRestoreFocus();
  const descriptionId = useId();
  const budgetAccountId = useId();
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  // The settings page renders categories only once a budget account exists.
  const [account, setAccount] = useState(initial?.budgetAccountId ?? budgetAccounts[0]?.id ?? 0);
  const [error, setError] = useState<string>();
  // The new budget, asked for only when the category moves to the other period.
  const [budgetText, setBudgetText] = useState("");
  const [noBudget, setNoBudget] = useState(false);
  const [budgetError, setBudgetError] = useState<string>();
  const submit = useMutation({
    mutationFn: ({ fields, changes }: { fields: CategoryFields; changes: Schemas["CategoryUpdateIn"] }) =>
      onSubmit(fields, changes),
    onSuccess: onClose,
  });

  const moved = initial !== undefined && account !== initial.budgetAccountId;
  const fromPeriod = initial ? periodOf(budgetAccounts, initial.budgetAccountId) : undefined;
  const toPeriod = periodOf(budgetAccounts, account);
  // A move between a monthly and an annual budget account clears the old budgets, so the
  // API needs the new one (BUDGET_RESET_REQUIRED otherwise).
  const periodChange =
    moved && fromPeriod !== undefined && toPeriod !== undefined && fromPeriod !== toPeriod
      ? { from: fromPeriod, to: toPeriod }
      : null;

  function handle(event: React.FormEvent) {
    event.preventDefault();
    const fields = categoryFields(name, description, account);
    const reset = periodChange ? budgetReset(budgetText, noBudget) : null;
    setError(fields.name ? undefined : S.common.nameRequired);
    setBudgetError(
      reset && !reset.valid ? (reset.reason === "required" ? R.required : S.budgets.invalid) : undefined,
    );
    if (!fields.name || (reset && !reset.valid)) return;
    const changes = initial ? categoryChanges(initial, fields) : {};
    if (changes === null) onClose();
    else submit.mutate({ fields, changes: reset?.valid ? { ...changes, budget_amount: reset.amount } : changes });
  }

  return (
    <Dialog open onOpenChange={(open) => (!open && !submit.isPending ? onClose() : undefined)}>
      <DialogContent closeLabel={S.common.close} className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handle} noValidate className="grid gap-4">
          <FormField
            label={T.name}
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={placeholder}
            error={error}
            maxLength={NAME_MAX}
            autoFocus
          />
          <div className="space-y-1.5">
            <Label htmlFor={budgetAccountId}>{T.budgetAccount}</Label>
            <BudgetAccountPicker
              id={budgetAccountId}
              budgetAccounts={budgetAccounts}
              value={account}
              onChange={setAccount}
              describedBy={`${budgetAccountId}-note`}
            />
            <p
              id={`${budgetAccountId}-note`}
              className={moved ? "text-xs text-warning-foreground" : "text-xs text-muted-foreground"}
            >
              {periodChange
                ? R.warning(PERIOD_NAMES[periodChange.from], PERIOD_NAMES[periodChange.to])
                : moved
                  ? T.budgetAccountMoveHint
                  : T.budgetAccountHint}
            </p>
          </div>
          {periodChange ? (
            <div className="space-y-2 rounded-lg bg-warning-soft/60 p-3">
              <FormField
                label={R.label[periodChange.to]}
                hint={R.hint[periodChange.to]}
                error={budgetError}
                value={noBudget ? "" : budgetText}
                onChange={(event) => {
                  setBudgetError(undefined);
                  setBudgetText(event.target.value);
                }}
                disabled={noBudget}
                inputMode="decimal"
                autoComplete="off"
                placeholder={noBudget ? S.budgets.noBudget : undefined}
                className="num bg-card text-right"
              />
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={noBudget}
                  onChange={(event) => {
                    setBudgetError(undefined);
                    setNoBudget(event.target.checked);
                  }}
                  className="accent-primary"
                />
                {R.none}
              </label>
            </div>
          ) : null}
          <div className="space-y-1.5">
            <Label htmlFor={descriptionId}>{T.descriptionLabel}</Label>
            <Textarea
              id={descriptionId}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder={T.descriptionPlaceholder}
              maxLength={CATEGORY_DESCRIPTION_MAX}
              rows={3}
              aria-describedby={`${descriptionId}-note`}
            />
            <div id={`${descriptionId}-note`} className="flex gap-3 text-xs text-muted-foreground">
              <p className="flex-1">{T.descriptionHint}</p>
              <p className="num shrink-0">
                {T.descriptionCount(description.length, CATEGORY_DESCRIPTION_MAX)}
              </p>
            </div>
          </div>
          <FormError message={submit.isError ? errorMessage(submit.error) : null} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={submit.isPending}>
              {S.common.cancel}
            </Button>
            <Button type="submit" disabled={submit.isPending}>
              {submit.isPending ? pendingLabel : submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
