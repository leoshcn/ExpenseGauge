import type { Schemas } from "@/api/client";
import type { BudgetScope } from "@/api/queries";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { S } from "@/strings.zh";

const ALL = "all";

/** Picks the one budget account a level-2 category belongs to (no "全部"). */
export function BudgetAccountPicker({
  id,
  budgetAccounts,
  value,
  onChange,
  label,
  describedBy,
  className,
}: {
  id?: string;
  budgetAccounts: readonly Schemas["BudgetAccountOut"][];
  value: number;
  onChange: (id: number) => void;
  /** Accessible name when there is no visible `<Label htmlFor={id}>`. */
  label?: string;
  describedBy?: string;
  className?: string;
}) {
  return (
    <Select value={String(value)} onValueChange={(next) => onChange(Number(next))}>
      <SelectTrigger
        id={id}
        aria-label={label}
        aria-describedby={describedBy}
        className={className ?? "w-full"}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent position="popper">
        {budgetAccounts.map((account) => (
          <SelectItem key={account.id} value={String(account.id)}>
            <span className="truncate">{account.name}</span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/**
 * The budget-account picker in the Dashboard and budgets headers: "全部" or one budget
 * account. Pages keep the choice in the URL (`?scope=<id>`, read by `useBudgetScope` in
 * hooks/use-search-state.ts); "全部" is the default and is left out of the URL.
 */
export function BudgetAccountSelect({
  budgetAccounts,
  value,
  onChange,
}: {
  budgetAccounts: readonly Schemas["BudgetAccountOut"][];
  value: BudgetScope;
  onChange: (scope: BudgetScope) => void;
}) {
  return (
    <Select
      value={value === null ? ALL : String(value)}
      onValueChange={(next) => onChange(next === ALL ? null : Number(next))}
    >
      <SelectTrigger aria-label={S.budgetScope.label} className="max-w-[60vw] min-w-36 bg-card">
        <SelectValue />
      </SelectTrigger>
      <SelectContent align="end" position="popper">
        <SelectItem value={ALL}>{S.budgetScope.all}</SelectItem>
        {budgetAccounts.length > 0 ? <SelectSeparator /> : null}
        {budgetAccounts.map((account) => (
          <SelectItem key={account.id} value={String(account.id)}>
            <span className="truncate">{account.name}</span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
