import { cn } from "cn";
import { useId } from "react";

import type { Schemas } from "@/api/client";
import type { RefundStatus } from "@/api/queries";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatMonth } from "@/lib/date";
import { S } from "@/strings.zh";

import { findCategory, monthOptions } from "./model";

const T = S.transactions.filters;
const ALL = "all";

/** What a filter change sets in the URL; `null` removes the parameter ("all"). */
export type FilterChange = {
  month?: string | null;
  channel?: number | null;
  budget_account?: number | null;
  category?: number | null;
  refund?: RefundStatus | null;
};

/** A labelled select with an "all" option first. */
function FilterSelect({
  label,
  value,
  allLabel,
  onChange,
  triggerClassName,
  display,
  children,
}: {
  label: string;
  value: string | null;
  allLabel: string;
  onChange: (value: string | null) => void;
  triggerClassName: string;
  /** What the closed select shows, when it is not just the chosen item's text. */
  display?: React.ReactNode;
  children: React.ReactNode;
}) {
  const id = useId();
  return (
    <div className="min-w-0 space-y-1.5">
      <Label htmlFor={id} className="text-xs text-muted-foreground">
        {label}
      </Label>
      <Select value={value ?? ALL} onValueChange={(next) => onChange(next === ALL ? null : next)}>
        <SelectTrigger id={id} className={cn("w-full bg-card", triggerClassName)}>
          {display ? (
            <SelectValue>
              <span className="truncate">{display}</span>
            </SelectValue>
          ) : (
            <SelectValue />
          )}
        </SelectTrigger>
        <SelectContent position="popper" className="max-h-80">
          <SelectItem value={ALL}>{allLabel}</SelectItem>
          {children}
        </SelectContent>
      </Select>
    </div>
  );
}

const idOrNull = (value: string | null) => (value === null ? null : Number(value));

/**
 * Month, payment channel, budget account and category filters. `null` is "all"; a level-1
 * category includes its children. The category list is the global tree, whatever the
 * budget-account filter: the two are combined by the API. A toggle narrows the list to
 * refunds that are not matched to a payment yet, for cleaning up older refunds.
 */
export function Filters({
  tree,
  channels,
  budgetAccounts,
  month,
  channelId,
  budgetAccountId,
  categoryId,
  refundStatus,
  now,
  onChange,
  className,
}: {
  tree: Schemas["CategoryTree"];
  channels: readonly Schemas["ChannelOut"][];
  budgetAccounts: readonly Schemas["BudgetAccountOut"][];
  month: string | null;
  channelId: number | null;
  budgetAccountId: number | null;
  categoryId: number | null;
  refundStatus: RefundStatus | null;
  now: Date;
  onChange: (next: FilterChange) => void;
  className?: string;
}) {
  const found = categoryId === null ? null : findCategory(tree, categoryId);
  const categoryLabel = found
    ? found.child
      ? T.categoryOf(found.parent.name, found.child.name)
      : `${found.parent.name} · ${T.allOf}`
    : T.allCategories;

  return (
    <div className={cn("grid grid-cols-2 gap-3 sm:flex sm:flex-wrap sm:items-end", className)}>
      <FilterSelect
        label={T.month}
        value={month}
        allLabel={T.allMonths}
        onChange={(value) => onChange({ month: value })}
        triggerClassName="num sm:w-36"
      >
        <SelectSeparator />
        {monthOptions(now, month).map((option) => (
          <SelectItem key={option} value={option} className="num">
            {formatMonth(option)}
          </SelectItem>
        ))}
      </FilterSelect>
      <FilterSelect
        label={T.channel}
        value={channelId === null ? null : String(channelId)}
        allLabel={T.allChannels}
        onChange={(value) => onChange({ channel: idOrNull(value) })}
        triggerClassName="sm:w-40"
      >
        {channels.length > 0 ? <SelectSeparator /> : null}
        {channels.map((channel) => (
          <SelectItem key={channel.id} value={String(channel.id)}>
            {channel.name}
          </SelectItem>
        ))}
      </FilterSelect>
      <FilterSelect
        label={T.budgetAccount}
        value={budgetAccountId === null ? null : String(budgetAccountId)}
        allLabel={T.allBudgetAccounts}
        onChange={(value) => onChange({ budget_account: idOrNull(value) })}
        triggerClassName="sm:w-36"
      >
        {budgetAccounts.length > 0 ? <SelectSeparator /> : null}
        {budgetAccounts.map((account) => (
          <SelectItem key={account.id} value={String(account.id)}>
            {account.name}
          </SelectItem>
        ))}
      </FilterSelect>
      <FilterSelect
        label={T.category}
        value={categoryId === null ? null : String(categoryId)}
        allLabel={T.allCategories}
        onChange={(value) => onChange({ category: idOrNull(value) })}
        triggerClassName="sm:w-56"
        display={categoryLabel}
      >
        {tree.categories.map((parent) => (
          <SelectGroup key={parent.id} aria-label={parent.name}>
            <SelectSeparator />
            <SelectItem value={String(parent.id)} className="font-medium">
              {parent.name}
              <span className="text-xs font-normal text-muted-foreground">{T.allOf}</span>
            </SelectItem>
            {parent.children.map((child) => (
              <SelectItem key={child.id} value={String(child.id)} className="pl-6">
                {child.name}
              </SelectItem>
            ))}
          </SelectGroup>
        ))}
      </FilterSelect>
      <Button
        type="button"
        variant="outline"
        aria-pressed={refundStatus === "unmatched"}
        title={T.unmatchedOnlyHint}
        onClick={() => onChange({ refund: refundStatus === "unmatched" ? null : "unmatched" })}
        className={cn(
          "col-span-2 bg-card sm:col-span-1",
          refundStatus === "unmatched" && "border-warning bg-warning-soft text-warning-foreground hover:bg-warning-soft",
        )}
      >
        {T.unmatchedOnly}
      </Button>
    </div>
  );
}
