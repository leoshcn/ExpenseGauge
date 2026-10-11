import { useMutation } from "@tanstack/react-query";
import { cn } from "cn";
import { useId, useState } from "react";

import { errorMessage, type Schemas } from "@/api/client";
import { FormError, FormField } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useRestoreFocus } from "@/hooks/use-restore-focus";
import { S } from "@/strings.zh";

const B = S.settings.budgetAccounts;
const NAME_MAX = 100;
const PERIODS = ["month", "year"] as const;

type Period = Schemas["BudgetAccountOut"]["period"];

/**
 * Adds a budget account: its name and its period (monthly or annual), which cannot be
 * changed later. Mounted only while open; closes on success and shows the backend's
 * refusal (`BUDGET_ACCOUNT_NAME_TAKEN`) in place.
 */
export function CreateBudgetAccountDialog({
  onSubmit,
  onClose,
}: {
  onSubmit: (body: Schemas["BudgetAccountCreateIn"]) => Promise<unknown>;
  onClose: () => void;
}) {
  useRestoreFocus();
  const periodId = useId();
  const [name, setName] = useState("");
  const [period, setPeriod] = useState<Period>("month");
  const [error, setError] = useState<string>();
  const submit = useMutation({
    mutationFn: (body: Schemas["BudgetAccountCreateIn"]) => onSubmit(body),
    onSuccess: onClose,
  });

  function handle(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setError(S.common.nameRequired);
      return;
    }
    setError(undefined);
    submit.mutate({ name: trimmed, period });
  }

  return (
    <Dialog open onOpenChange={(open) => (!open && !submit.isPending ? onClose() : undefined)}>
      <DialogContent closeLabel={S.common.close} className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{B.addTitle}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handle} noValidate className="grid gap-4">
          <FormField
            label={B.name}
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={B.namePlaceholder}
            error={error}
            maxLength={NAME_MAX}
            autoFocus
          />
          <fieldset className="space-y-2" aria-describedby={`${periodId}-note`}>
            <legend className="mb-1.5 text-sm leading-none font-medium">{B.period}</legend>
            {PERIODS.map((option) => (
              <label
                key={option}
                className={cn(
                  "flex cursor-pointer gap-3 rounded-lg border px-3 py-2.5 transition-colors hover:bg-muted/50",
                  period === option && "border-primary bg-accent/60",
                )}
              >
                <input
                  type="radio"
                  name={periodId}
                  value={option}
                  checked={period === option}
                  onChange={() => setPeriod(option)}
                  className="mt-1 accent-primary"
                />
                <span className="min-w-0">
                  <span className="block font-medium">{B.periods[option]}</span>
                  <span className="block text-xs text-muted-foreground">{B.periodHints[option]}</span>
                </span>
              </label>
            ))}
            <p id={`${periodId}-note`} className="text-xs text-muted-foreground">
              {B.periodFixed}
            </p>
          </fieldset>
          <FormError message={submit.isError ? errorMessage(submit.error) : null} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={submit.isPending}>
              {S.common.cancel}
            </Button>
            <Button type="submit" disabled={submit.isPending}>
              {submit.isPending ? B.creating : B.create}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
