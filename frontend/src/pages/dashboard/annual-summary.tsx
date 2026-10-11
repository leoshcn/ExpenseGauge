import { cn } from "cn";

import type { Schemas } from "@/api/client";
import { BudgetMeter } from "@/components/budget-meter";
import { countByState, usage, usagePercent, yearProgress } from "@/lib/budget";
import { absolute, formatMoney, formatPercent } from "@/lib/money";
import { monthOf, parseMonth } from "@/lib/month";
import { S } from "@/strings.zh";

import { Figure, MonthHeader } from "./month-summary";

const T = S.dashboard;
const A = T.annual;

/**
 * An annual budget account through the selected month: the month stepper, the year to
 * date against the annual budget, and the year's time progress as a tick on the meter.
 * Only spending above the budget counts as over; spending ahead of the time progress is
 * left for the reader to see from the tick.
 */
export function AnnualSummary({
  account,
  currency,
  through,
  firstMonth,
  lastMonth,
  onMonthChange,
  now,
  className,
}: {
  account: Schemas["AnnualAccount"];
  currency: string;
  through: string;
  firstMonth: string;
  lastMonth: string;
  onMonthChange: (month: string) => void;
  now: Date;
  className?: string;
}) {
  const { year, month } = parseMonth(through);
  const total = usage(account.budget, account.actual);
  const progress = yearProgress(through, now);
  const counts = countByState(account.categories);
  const money = (value: string) => formatMoney(value, currency);
  const percent = usagePercent(total);

  return (
    <section
      aria-label={A.through(year, month)}
      className={cn("flex flex-col rounded-xl border bg-card p-5 shadow-card", className)}
    >
      <MonthHeader
        title={A.through(year, month)}
        current={monthOf(now) === through}
        month={through}
        firstMonth={firstMonth}
        lastMonth={lastMonth}
        onMonthChange={onMonthChange}
      />

      <div className="mt-5">
        <div className="text-xs text-muted-foreground">{A.actual}</div>
        <div className="num text-display font-semibold">{money(account.actual)}</div>
      </div>

      <div className="mt-4">
        <BudgetMeter
          usage={total}
          size="md"
          label={A.budget}
          marker={total.state === "none" ? null : progress}
          markerLabel={A.marker}
        />
        <div className="num mt-2 flex min-h-[1.125rem] justify-between gap-3 text-xs text-muted-foreground">
          {percent ? (
            <span className={cn(total.state === "over" && "font-medium text-over")}>{T.summary.used(percent)}</span>
          ) : (
            <span />
          )}
          {total.state !== "none" ? <span>{A.elapsed(formatPercent(progress))}</span> : null}
        </div>
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-4 border-t pt-4">
        {account.budget === null || total.remaining === null ? (
          <Figure label={A.budget} value={T.summary.noBudget} tone="muted" />
        ) : (
          <>
            <Figure label={A.budget} value={money(account.budget)} />
            {total.state === "over" ? (
              <Figure label={T.summary.over} value={money(absolute(total.remaining))} tone="over" />
            ) : (
              <Figure label={T.summary.remaining} value={money(total.remaining)} />
            )}
          </>
        )}
      </dl>

      <div className="mt-auto flex flex-wrap gap-2 pt-4">
        {counts.over > 0 ? (
          <span className="rounded-full bg-over-soft px-2.5 py-1 text-xs font-medium text-over">
            {T.summary.overCategories(counts.over)}
          </span>
        ) : null}
        {counts.near > 0 ? (
          <span className="rounded-full bg-warning-soft px-2.5 py-1 text-xs font-medium text-warning-foreground">
            {T.summary.nearCategories(counts.near)}
          </span>
        ) : null}
        {counts.over === 0 && counts.near === 0 && counts.ok > 0 ? (
          <span className="rounded-full bg-positive-soft px-2.5 py-1 text-xs font-medium text-positive">
            {T.summary.allWithin}
          </span>
        ) : null}
      </div>
    </section>
  );
}
