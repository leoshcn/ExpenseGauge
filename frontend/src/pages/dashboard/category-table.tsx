import { cn } from "cn";
import { ChevronRightIcon } from "lucide-react";
import { Fragment, useState } from "react";

import type { Schemas } from "@/api/client";
import { BudgetMeter } from "@/components/budget-meter";
import { Button } from "@/components/ui/button";
import { usage, usagePercent } from "@/lib/budget";
import { absolute, formatMoney } from "@/lib/money";
import { S } from "@/strings.zh";

const T = S.dashboard.table;

type RowData = { name: string; budget: string | null; actual: string };

/** Budget, actual, remaining and meter for one row, at either level or for the total. */
function Row({
  row,
  currency,
  kind,
  expanded,
  onToggle,
}: {
  row: RowData;
  currency: string;
  kind: "parent" | "child" | "total";
  expanded?: boolean;
  onToggle?: () => void;
}) {
  const used = usage(row.budget, row.actual);
  const money = (value: string) => formatMoney(value, currency);
  const over = used.state === "over";
  const percent = usagePercent(used);
  const remaining =
    used.remaining === null
      ? null
      : over
        ? T.overBy(money(absolute(used.remaining)))
        : money(used.remaining);
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
              <BudgetMeter usage={used} label={meterLabel} className="flex-1" />
            </div>
          )}
          <div className={cn("num text-xs text-muted-foreground", over && "text-over")}>
            {row.budget === null || remaining === null
              ? T.noBudget
              : `${T.budgetOf(money(row.budget))} · ${over ? remaining : T.remainingOf(remaining)}`}
          </div>
        </div>
      </th>
      <td className={cn("num hidden px-3 text-right md:table-cell", cell)}>
        {row.budget === null ? (
          <span className="text-xs text-muted-foreground">{T.noBudget}</span>
        ) : (
          money(row.budget)
        )}
      </td>
      <td className={cn("num px-4 text-right align-top font-medium whitespace-nowrap max-md:w-px sm:px-5 md:px-3 md:align-middle", cell)}>
        {money(row.actual)}
        {/* Below `md` the percentage sits under the amount, level with the meter. */}
        {percent ? (
          <div className={cn("mt-1.5 text-xs font-normal text-muted-foreground md:hidden", over && "font-medium text-over")}>
            {percent}
          </div>
        ) : null}
      </td>
      <td className={cn("num hidden px-3 text-right md:table-cell", cell, over && "font-medium text-over")}>
        {remaining ?? <span className="text-muted-foreground">{S.common.none}</span>}
      </td>
      <td className={cn("hidden w-[22%] min-w-40 py-3 pr-5 pl-3 md:table-cell", cell)}>
        {used.state === "none" ? (
          <span className="text-xs text-muted-foreground">{T.noBudgetProgress}</span>
        ) : (
          <div className="flex items-center gap-2">
            <BudgetMeter usage={used} label={meterLabel} className="flex-1" />
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
 */
export function CategoryTable({
  detail,
  className,
}: {
  detail: Schemas["MonthDetailOut"];
  className?: string;
}) {
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
              {T.budget}
            </th>
            <th scope="col" className={cn(heading, "px-4 text-right sm:px-5 md:px-3")}>
              {T.actual}
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
                />
                {expanded
                  ? parent.children.map((child) => (
                      <Row key={child.category_id} row={child} currency={detail.currency} kind="child" />
                    ))
                  : null}
              </Fragment>
            );
          })}
        </tbody>
        <tfoot>
          <Row
            row={{ name: T.total, budget: detail.budget, actual: detail.actual }}
            currency={detail.currency}
            kind="total"
          />
        </tfoot>
      </table>
    </section>
  );
}
