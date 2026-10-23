import { cn } from "cn";
import { CalendarClockIcon, RefreshCwIcon } from "lucide-react";

import type { Schemas } from "@/api/client";
import { BudgetMeter } from "@/components/budget-meter";
import { countByState, usage, usagePercent } from "@/lib/budget";
import { absolute, formatMoney, formatPercent, toCents } from "@/lib/money";
import { monthElapsed, parseMonth } from "@/lib/month";
import { S } from "@/strings.zh";

const T = S.dashboard;

/** The summary card's title with the "本月" chip; the month is chosen in the month bar. */
export function MonthHeader({ title, current }: { title: string; current: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <h2 className="num text-base font-semibold" aria-live="polite">
        {title}
      </h2>
      {current ? (
        <span className="rounded-full bg-accent px-2 py-0.5 text-xs text-accent-foreground">
          {T.month.current}
        </span>
      ) : null}
    </div>
  );
}

/** A labelled figure under a summary's meter. */
export function Figure({
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
          tone === "muted" ? "text-sm font-normal text-muted-foreground" : "amount",
        )}
      >
        {value}
      </dd>
    </div>
  );
}

/**
 * The selected month at a glance, compact: the month's spending and its
 * notes beside the budget, remaining and overall meter (stacked on phones).
 */
export function MonthSummary({
  detail,
  month,
  now,
  forecast = null,
  className,
}: {
  detail: Schemas["MonthDetailOut"];
  /** The current month's forecast from the scheduled expenses, when there is one. */
  forecast?: Schemas["ScheduleForecast"] | null;
  month: string;
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
      className={cn("flex flex-col rounded-xl border bg-card p-4 shadow-card sm:px-5", className)}
    >
      <MonthHeader
        title={T.month.long(year, monthNumber)}
        current={elapsed !== null}
      />

      <div className="mt-3 grid gap-4 sm:grid-cols-2 sm:gap-6">
        <div className="min-w-0">
          <div className="text-xs text-muted-foreground">{T.summary.actual}</div>
          <div className="num amount text-2xl leading-tight font-semibold">{money(detail.actual)}</div>
          <p className="num mt-1 text-xs text-muted-foreground" title={T.summary.countHint}>
            {T.summary.count(detail.count)}
          </p>
          {/* "全部": annual accounts' spending is left out of the comparison above. */}
          {toCents(detail.annual_actual) > 0 ? (
            <p className="num mt-1 flex items-center gap-1.5 text-xs text-muted-foreground" title={T.summary.annualExtraHint}>
              <span aria-hidden="true" className="size-2 shrink-0 rounded-[2px] bg-chart-annual" />
              <span className="amount">{T.summary.annualExtra(money(detail.annual_actual))}</span>
            </p>
          ) : null}
          {forecast !== null && toCents(forecast.outstanding) > 0 ? (
            <p className="num mt-1 flex items-center gap-1.5 text-xs text-muted-foreground" title={T.summary.forecastHint}>
              <CalendarClockIcon aria-hidden="true" className="size-3 shrink-0" />
              <span className="amount">
                {T.summary.forecast(money(forecast.projected), money(forecast.outstanding))}
              </span>
            </p>
          ) : null}
          {detail.rollover_available !== null ? (
            <p
              className={cn(
                "num mt-1 flex items-center gap-1.5 text-xs text-muted-foreground",
                toCents(detail.rollover_available) < 0 && "text-over",
              )}
              title={T.table.carryInHint}
            >
              <RefreshCwIcon aria-hidden="true" className="size-3 shrink-0" />
              <span className="amount">{T.summary.rolloverAvailable(money(detail.rollover_available))}</span>
            </p>
          ) : null}
        </div>

        <div className="min-w-0">
          <dl className="grid grid-cols-2 gap-4">
            {detail.budget === null || total.remaining === null ? (
              <Figure label={T.summary.budget} value={T.summary.noBudget} tone="muted" />
            ) : (
              <>
                <Figure label={T.summary.budget} value={money(detail.budget)} />
                {total.state === "over" ? (
                  <Figure label={T.summary.over} value={money(absolute(total.remaining))} tone="over" />
                ) : (
                  <Figure label={T.summary.remaining} value={money(total.remaining)} />
                )}
              </>
            )}
          </dl>
          <div className="mt-3">
            <BudgetMeter
              usage={total}
              size="md"
              label={T.summary.budget}
              marker={total.state === "none" ? null : elapsed}
              markerLabel={T.summary.todayMarker}
            />
            <div className="num mt-1.5 flex min-h-[1.125rem] justify-between gap-3 text-xs text-muted-foreground">
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
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-2 empty:hidden">
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
