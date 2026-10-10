import { cn } from "cn";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";

import type { Schemas } from "@/api/client";
import { BudgetMeter } from "@/components/budget-meter";
import { Button } from "@/components/ui/button";
import { countByState, usage, usagePercent } from "@/lib/budget";
import { absolute, formatMoney, formatPercent } from "@/lib/money";
import { addMonths, monthElapsed, parseMonth } from "@/lib/month";
import { S } from "@/strings.zh";


const T = S.dashboard;

function Figure({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "over" | "muted";
}) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd
        className={cn(
          "num truncate text-base font-medium",
          tone === "over" && "text-over",
          tone === "muted" && "text-sm font-normal text-muted-foreground",
        )}
      >
        {value}
      </dd>
    </div>
  );
}

/** The selected month at a glance: the month stepper, the three totals and the overall meter. */
export function MonthSummary({
  detail,
  month,
  firstMonth,
  lastMonth,
  onMonthChange,
  now,
  className,
}: {
  detail: Schemas["MonthDetailOut"];
  month: string;
  firstMonth: string;
  lastMonth: string;
  onMonthChange: (month: string) => void;
  now: Date;
  className?: string;
}) {
  const { year, month: monthNumber } = parseMonth(month);
  const total = usage(detail.budget, detail.actual);
  const elapsed = monthElapsed(month, now);
  const counts = countByState(detail.categories);
  const money = (value: string) => formatMoney(value, detail.currency);
  const percent = usagePercent(total);

  return (
    <section
      aria-label={T.month.long(year, monthNumber)}
      className={cn("flex flex-col rounded-xl border bg-card p-5 shadow-card", className)}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h2 className="num text-base font-semibold" aria-live="polite">
            {T.month.long(year, monthNumber)}
          </h2>
          {elapsed !== null ? (
            <span className="rounded-full bg-accent px-2 py-0.5 text-xs text-accent-foreground">
              {T.month.current}
            </span>
          ) : null}
        </div>
        <div className="flex gap-1">
          <Button
            variant="outline"
            size="icon-sm"
            disabled={month <= firstMonth}
            onClick={() => onMonthChange(addMonths(month, -1))}
            aria-label={T.month.previous}
          >
            <ChevronLeftIcon />
          </Button>
          <Button
            variant="outline"
            size="icon-sm"
            disabled={month >= lastMonth}
            onClick={() => onMonthChange(addMonths(month, 1))}
            aria-label={T.month.next}
          >
            <ChevronRightIcon />
          </Button>
        </div>
      </div>

      <div className="mt-5">
        <div className="text-xs text-muted-foreground">{T.summary.actual}</div>
        <div className="num text-display font-semibold">{money(detail.actual)}</div>
      </div>

      <div className="mt-4">
        <BudgetMeter
          usage={total}
          size="md"
          label={T.summary.budget}
          marker={total.state === "none" ? null : elapsed}
          markerLabel={T.summary.todayMarker}
        />
        <div className="num mt-2 flex min-h-[1.125rem] justify-between gap-3 text-xs text-muted-foreground">
          {percent ? (
            <span className={cn(total.state === "over" && "font-medium text-over")}>
              {T.summary.used(percent)}
            </span>
          ) : (
            <span />
          )}
          {elapsed !== null && total.state !== "none" ? (
            <span>{T.summary.elapsed(formatPercent(elapsed))}</span>
          ) : null}
        </div>
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-4 border-t pt-4">
        {detail.budget === null || total.remaining === null ? (
          <Figure label={T.summary.budget} value={T.summary.noBudget} tone="muted" />
        ) : (
          <>
            <Figure label={T.summary.budget} value={money(detail.budget)} />
            {total.state === "over" ? (
              <Figure
                label={T.summary.over}
                value={money(absolute(total.remaining))}
                tone="over"
              />
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
