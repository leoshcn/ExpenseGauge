import { cn } from "cn";
import { ChevronRightIcon } from "lucide-react";

import type { Schemas } from "@/api/client";
import { BudgetMeter } from "@/components/budget-meter";
import { usage, usagePercent, yearProgress } from "@/lib/budget";
import { formatMoney } from "@/lib/money";
import { parseMonth } from "@/lib/month";
import { S } from "@/strings.zh";

const T = S.dashboard.annual;

/**
 * The annual budget accounts in "全部", which leaves them out of the monthly comparison:
 * one row each with the year to date against the annual budget, through the selected
 * month, and the year's time progress on the meter. A row opens that account's view.
 */
export function AnnualCard({
  summary,
  now,
  onOpen,
  className,
}: {
  summary: Schemas["AnnualSummaryOut"];
  now: Date;
  onOpen: (budgetAccountId: number) => void;
  className?: string;
}) {
  const { year, month } = parseMonth(summary.through);
  const progress = yearProgress(summary.through, now);
  const money = (value: string) => formatMoney(value, summary.currency);

  return (
    <section className={cn("overflow-hidden rounded-xl border bg-card shadow-card", className)}>
      <div className="px-4 py-4 sm:px-5">
        <h2 className="text-base font-semibold">{T.card.title}</h2>
        <p className="num text-xs text-muted-foreground">{T.card.description(year, month)}</p>
      </div>
      <ul className="grid md:grid-cols-2">
        {summary.accounts.map((account) => {
          const used = usage(account.budget, account.actual);
          const over = used.state === "over";
          const percent = usagePercent(used);
          return (
            <li
              key={account.budget_account_id}
              className="cursor-pointer border-t px-4 py-3 transition-colors hover:bg-muted/50 sm:px-5 md:odd:border-r"
              onClick={() => onOpen(account.budget_account_id)}
            >
              <div className="flex items-center justify-between gap-3">
                <button
                  type="button"
                  aria-label={T.card.open(account.name)}
                  onClick={(event) => {
                    event.stopPropagation();
                    onOpen(account.budget_account_id);
                  }}
                  className="-ml-1 flex min-w-0 items-center gap-1 rounded-md px-1 font-medium outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                >
                  <span className="truncate">{account.name}</span>
                  <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground" />
                </button>
                {over ? (
                  <span className="shrink-0 rounded-full bg-over-soft px-1.5 text-[11px] leading-[1.125rem] font-medium text-over">
                    {S.dashboard.table.over}
                  </span>
                ) : null}
              </div>
              <div className={cn("num mt-1 text-sm", over && "text-over")}>
                {account.budget === null ? (
                  <>
                    {money(account.actual)}
                    <span className="text-xs text-muted-foreground"> · {T.card.noBudget}</span>
                  </>
                ) : (
                  T.card.figures(money(account.actual), money(account.budget))
                )}
              </div>
              <div className="num text-xs text-muted-foreground">{T.card.count(account.count)}</div>
              {used.state === "none" ? null : (
                <div className="mt-2 flex items-center gap-2">
                  <BudgetMeter
                    usage={used}
                    label={T.card.progressLabel(account.name)}
                    marker={progress}
                    markerLabel={T.marker}
                    className="flex-1"
                  />
                  <span className={cn("num w-11 text-right text-xs text-muted-foreground", over && "font-medium text-over")}>
                    {percent ?? S.common.none}
                  </span>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
