import { cn } from "cn";
import { ChevronRightIcon, RefreshCwIcon } from "lucide-react";
import { Fragment, useState } from "react";

import type { Schemas } from "@/api/client";
import { BudgetMeter } from "@/components/budget-meter";
import { Button } from "@/components/ui/button";
import { rolloverBudget, usage, usagePercent } from "@/lib/budget";
import { absolute, formatMoney, signedMoney } from "@/lib/money";
import { S } from "@/strings.zh";

const T = S.dashboard.table;

/** `carry_in` is set on a rollover category's row (level 2, monthly view). */
type RowData = { name: string; budget: string | null; actual: string; count: number; carry_in?: string | null };

/** A tick on every meter (the year's time progress in an annual view). */
type Marker = { at: number; label: string };

/** What the table shows: a month's detail, or an annual account's year to date. */
type TableData = Pick<Schemas["MonthDetailOut"], "currency" | "budget" | "actual" | "count" | "categories">;

/** Budget, actual, remaining and meter for one row, at either level or for the total. */
function Row({
  row,
  currency,
  kind,
  expanded,
  onToggle,
  marker,
}: {
  row: RowData;
  currency: string;
  kind: "parent" | "child" | "total";
  expanded?: boolean;
  onToggle?: () => void;
  marker?: Marker;
}) {
  const carryIn = row.carry_in ?? null;
  // A rollover category is measured against what it has this month: carry-in + budget.
  const used = usage(carryIn === null ? row.budget : rolloverBudget(carryIn, row.budget), row.actual);
  const money = (value: string) => formatMoney(value, currency);
  const over = used.state === "over";
  const percent = usagePercent(used);
  const remaining =
    used.remaining === null
      ? null
      : over
        ? T.overBy(money(absolute(used.remaining)))
        : carryIn !== null
          ? T.availableOf(money(used.remaining))
          : money(used.remaining);
  const carryLine = carryIn === null ? null : T.carryIn(signedMoney(carryIn, currency));
  const meterLabel = T.progressLabel(row.name);
  const cell = kind === "child" ? "py-2" : "py-3";

  return (
    <tr
      className={cn(
        "border-t",
        kind === "parent" && "cursor-pointer transition-colors hover:bg-muted/50",
        kind === "child" && "bg-muted/40 text-[13px]",
        kind === "total" && "font-medium",
      )}
      onClick={onToggle}
    >
      <th
        scope="row"
        className={cn(
          "px-4 text-left font-normal sm:px-5",
          cell,
          // An over-budget row carries a vermilion edge so it is found without reading.
          over && kind !== "total" && "shadow-[inset_3px_0_0_var(--over)]",
        )}
      >
        <div className={cn("flex items-center gap-2", kind === "child" && "pl-7")}>
          {kind === "parent" ? (
            <button
              type="button"
              aria-expanded={expanded}
              aria-label={expanded ? T.collapse(row.name) : T.expand(row.name)}
              onClick={(event) => {
                event.stopPropagation();
                onToggle?.();
              }}
              className="-ml-1 flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-ring/50"
            >
              <ChevronRightIcon
                className={cn("size-4 transition-transform", expanded && "rotate-90")}
              />
            </button>
          ) : null}
          <span className={cn("min-w-0 truncate", kind !== "child" && "font-medium")}>{row.name}</span>
          {carryIn !== null ? (
            <span title={T.rollover} className="shrink-0 text-muted-foreground">
              <RefreshCwIcon className="size-3" aria-hidden="true" />
              <span className="sr-only">{T.rollover}</span>
            </span>
          ) : null}
          {over && kind !== "total" ? (
            <span className="shrink-0 rounded-full bg-over-soft px-1.5 text-[11px] leading-[1.125rem] font-medium text-over">
              {T.over}
            </span>
          ) : null}
        </div>
        {/* Below `md` the budget, remaining and meter columns fold in under the name. */}
        <div className={cn("mt-1.5 space-y-1.5 md:hidden", kind !== "total" && "pl-7")}>
          {used.state === "none" ? null : (
            <div className="flex h-[1.125rem] items-center">
              <BudgetMeter
                usage={used}
                label={meterLabel}
                marker={marker?.at}
                markerLabel={marker?.label}
                className="flex-1"
              />
            </div>
          )}
          <div className={cn("num text-xs text-muted-foreground", over && "text-over", remaining !== null && "amount")}>
            {remaining === null
              ? T.noBudget
              : `${row.budget === null ? T.noBudget : T.budgetOf(money(row.budget))} · ${
                  over || carryIn !== null ? remaining : T.remainingOf(remaining)
                }`}
            {carryLine ? <span className="ml-1">（{carryLine}）</span> : null}
          </div>
        </div>
      </th>
      <td className={cn("num hidden px-3 text-right md:table-cell", cell)}>
        {row.budget === null ? (
          <span className="text-xs text-muted-foreground">{T.noBudget}</span>
        ) : (
          <span className="amount">{money(row.budget)}</span>
        )}
      </td>
      <td className={cn("num px-4 text-right align-top font-medium whitespace-nowrap max-md:w-px sm:px-5 md:px-3 md:align-middle", cell)}>
        <span className="amount">{money(row.actual)}</span>
        {/* Below `md` the percentage sits under the amount, level with the meter. */}
        {percent ? (
          <div className={cn("mt-1.5 text-xs font-normal text-muted-foreground md:hidden", over && "font-medium text-over")}>
            {percent}
          </div>
        ) : null}
        {/* Below `md` the count column folds in under the amount too. */}
        <div className="mt-0.5 text-xs font-normal text-muted-foreground md:hidden">{T.countOf(row.count)}</div>
      </td>
      <td className={cn("num hidden px-3 text-right text-muted-foreground md:table-cell", cell)}>{row.count}</td>
      <td className={cn("num hidden px-3 text-right md:table-cell", cell, over && "font-medium text-over")}>
        {remaining === null ? (
          <span className="text-muted-foreground">{S.common.none}</span>
        ) : (
          <span className="amount">{remaining}</span>
        )}
        {carryLine ? (
          <div className="amount text-xs font-normal text-muted-foreground" title={T.carryInHint}>
            {carryLine}
          </div>
        ) : null}
      </td>
      <td className={cn("hidden w-[22%] min-w-40 py-3 pr-5 pl-3 md:table-cell", cell)}>
        {used.state === "none" ? (
          <span className="text-xs text-muted-foreground">{T.noBudgetProgress}</span>
        ) : (
          <div className="flex items-center gap-2">
            <BudgetMeter
              usage={used}
              label={meterLabel}
              marker={marker?.at}
              markerLabel={marker?.label}
              className="flex-1"
            />
            <span className={cn("num w-11 text-right text-xs text-muted-foreground", over && "font-medium text-over")}>
              {percent ?? S.common.none}
            </span>
          </div>
        )}
      </td>
    </tr>
  );
}

/**
 * The selected month by level-1 category; each row opens to its level-2 rows.
 * Rows keep the API's order so a category stays in the same place from month to month.
 * "笔数" is the consumption count (payments whose net amount after matched refunds is
 * above zero); below `md` it moves under the amount.
 * `variant="year"` shows an annual account's year to date: annual budgets, actual since
 * January, and `marker` (the year's time progress) on every meter.
 */
export function CategoryTable({
  detail,
  variant = "month",
  marker,
  className,
}: {
  detail: TableData;
  variant?: "month" | "year";
  marker?: Marker;
  className?: string;
}) {
  const headings = variant === "year" ? S.dashboard.annual.table : T;
  const [open, setOpen] = useState<ReadonlySet<number>>(new Set());
  const allOpen = detail.categories.length > 0 && detail.categories.every((c) => open.has(c.category_id));

  function toggle(id: number) {
    const next = new Set(open);
    if (!next.delete(id)) next.add(id);
    setOpen(next);
  }

  const heading = "px-3 py-2.5 text-xs font-medium text-muted-foreground";

  return (
    <section className={cn("overflow-hidden rounded-xl border bg-card shadow-card", className)}>
      <div className="flex items-center justify-between gap-3 px-4 py-4 sm:px-5">
        <h2 className="text-base font-semibold">{T.title}</h2>
        <Button
          variant="ghost"
          size="sm"
          className="-mr-2 text-muted-foreground"
          onClick={() => setOpen(allOpen ? new Set() : new Set(detail.categories.map((c) => c.category_id)))}
        >
          {allOpen ? T.collapseAll : T.expandAll}
        </Button>
      </div>
      <table className="w-full border-collapse">
        <thead>
          <tr className="border-t bg-muted/40">
            <th scope="col" className={cn(heading, "px-4 text-left sm:px-5")}>
              {T.category}
            </th>
            <th scope="col" className={cn(heading, "hidden text-right md:table-cell")}>
              {headings.budget}
            </th>
            <th scope="col" className={cn(heading, "px-4 text-right sm:px-5 md:px-3")}>
              {headings.actual}
            </th>
            <th scope="col" className={cn(heading, "hidden text-right md:table-cell")}>
              {T.count}
            </th>
            <th scope="col" className={cn(heading, "hidden text-right md:table-cell")}>
              {T.remaining}
            </th>
            <th scope="col" className={cn(heading, "hidden pr-5 text-left md:table-cell")}>
              {T.progress}
            </th>
          </tr>
        </thead>
        <tbody>
          {detail.categories.map((parent) => {
            const expanded = open.has(parent.category_id);
            return (
              <Fragment key={parent.category_id}>
                <Row
                  row={parent}
                  currency={detail.currency}
                  kind="parent"
                  expanded={expanded}
                  onToggle={() => toggle(parent.category_id)}
                  marker={marker}
                />
                {expanded
                  ? parent.children.map((child) => (
                      <Row
                        key={child.category_id}
                        row={child}
                        currency={detail.currency}
                        kind="child"
                        marker={marker}
                      />
                    ))
                  : null}
              </Fragment>
            );
          })}
        </tbody>
        <tfoot>
          <Row
            row={{ name: T.total, budget: detail.budget, actual: detail.actual, count: detail.count }}
            currency={detail.currency}
            kind="total"
            marker={marker}
          />
        </tfoot>
      </table>
    </section>
  );
}
