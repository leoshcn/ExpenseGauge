import { CartesianGrid, Line, LineChart, ReferenceLine, XAxis, YAxis } from "recharts";

import type { Schemas } from "@/api/client";
import { type ChartConfig, ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { usePrivacy } from "@/hooks/use-privacy";
import { formatMoney, formatMoneyCompact, toChartNumber } from "@/lib/money";
import { S } from "@/strings.zh";

import { paceSeries } from "./model";

const T = S.reports.pace;

const config = {
  current: { label: T.current, color: "var(--chart-actual)" },
  previous: { label: T.previous, color: "var(--chart-4)" },
  average: { label: T.average, color: "var(--chart-8)" },
} satisfies ChartConfig;

/**
 * Cumulative spending by day for the month (to today in the current month) against the
 * month before and the 3 months' average, with the month's budget as a line: "am I
 * spending faster than usual?".
 */
export function PaceChart({
  daily,
  month,
  now,
}: {
  daily: Schemas["DailyOut"];
  month: string;
  now: Date;
}) {
  const { hidden } = usePrivacy();
  const data = paceSeries(daily.days, month, now);
  const budget = daily.budgets.find((entry) => entry.month === month)?.budget ?? null;
  const money = (value: number) => formatMoney(value.toFixed(2), daily.currency);
  const lastCurrent = [...data].reverse().find((point) => point.current !== null);
  return (
    <section className="rounded-xl border bg-card p-4 shadow-card sm:p-5">
      <h2 className="text-base font-semibold">{T.title}</h2>
      <p className="text-xs text-muted-foreground">{T.description}</p>
      {lastCurrent ? (
        <p className="num amount mt-2 text-sm">
          {T.summary(money(lastCurrent.current ?? 0), money(lastCurrent.previous ?? 0))}
        </p>
      ) : null}
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {(Object.keys(config) as (keyof typeof config)[]).map((key) => (
          <span key={key} className="flex items-center gap-1.5">
            <span aria-hidden="true" className="h-0.5 w-3 rounded" style={{ background: config[key].color }} />
            {config[key].label}
          </span>
        ))}
        {budget !== null ? (
          <span className="flex items-center gap-1.5">
            <span aria-hidden="true" className="h-0 w-3 border-t border-dashed border-over" />
            {T.budget}
          </span>
        ) : null}
      </div>
      <ChartContainer config={config} role="img" aria-label={T.ariaLabel} className="mt-3 h-72 w-full">
        <LineChart data={data}>
          <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
          <XAxis
            dataKey="day"
            tickFormatter={(day: number) => T.dayTick(day)}
            ticks={[1, 5, 10, 15, 20, 25, 31]}
            tickLine={false}
            axisLine={false}
            fontSize={12}
            className="num"
          />
          <YAxis
            tickFormatter={(value: number) => (hidden ? S.privacy.hiddenTick : formatMoneyCompact(value, daily.currency))}
            width={56}
            tickLine={false}
            axisLine={false}
            fontSize={12}
            className="num"
          />
          <ChartTooltip
            content={
              <ChartTooltipContent
                className="num"
                labelFormatter={(_, payload) => T.tooltipDay(Number(payload?.[0]?.payload?.day ?? 0))}
                formatter={(value, name) => (
                  <div className="flex w-full items-center justify-between gap-4">
                    <span className="text-muted-foreground">{config[name as keyof typeof config]?.label}</span>
                    <span className="amount font-medium">{money(Number(value))}</span>
                  </div>
                )}
              />
            }
          />
          {budget !== null ? (
            <ReferenceLine y={toChartNumber(budget)} stroke="var(--over)" strokeDasharray="4 4" ifOverflow="extendDomain" />
          ) : null}
          <Line dataKey="average" stroke="var(--color-average)" strokeWidth={1.5} strokeDasharray="3 3" dot={false} isAnimationActive={false} />
          <Line dataKey="previous" stroke="var(--color-previous)" strokeWidth={1.5} dot={false} isAnimationActive={false} />
          <Line dataKey="current" stroke="var(--color-current)" strokeWidth={2.5} dot={false} connectNulls={false} isAnimationActive={false} />
        </LineChart>
      </ChartContainer>
    </section>
  );
}
