import { cn } from "cn";
import { Bar, CartesianGrid, ComposedChart, Line, ReferenceLine, XAxis, YAxis } from "recharts";

import type { Schemas } from "@/api/client";
import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import { useMediaQuery } from "@/hooks/use-media-query";
import { usePrivacy } from "@/hooks/use-privacy";
import { formatMoney, formatMoneyCompact, toChartNumber } from "@/lib/money";
import { S } from "@/strings.zh";

import { type AnnualTrendPoint, annualTrendPoints, niceTicksOf } from "./model";
import { MonthColumns, MonthTick, type TickProps } from "./trend-chart";

const T = S.dashboard;
const A = T.annual.trend;

const config = {
  actual: { label: A.legendMonth, color: "var(--chart-actual)" },
  cumulative: { label: A.legendCumulative, color: "var(--chart-annual)" },
  budget: { label: A.legendBudget, color: "var(--muted-foreground)" },
  pace: { label: A.legendPace, color: "var(--muted-foreground)" },
} satisfies ChartConfig;

function Legend({ budget }: { budget: boolean }) {
  const items = [
    { key: "actual", label: A.legendMonth, swatch: <span className="h-3 w-1.5 rounded-[2px] bg-chart-actual" /> },
    { key: "cumulative", label: A.legendCumulative, swatch: <span className="h-0.5 w-3 rounded-full bg-chart-annual" /> },
    ...(budget
      ? [
          { key: "budget", label: A.legendBudget, swatch: <span className="h-0.5 w-3 bg-muted-foreground" /> },
          {
            key: "pace",
            label: A.legendPace,
            swatch: <span className="w-3 border-t-2 border-dashed border-muted-foreground" />,
          },
        ]
      : []),
  ];
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
      {items.map((item) => (
        <li key={item.key} className="flex items-center gap-1.5">
          <span aria-hidden="true" className="flex items-center">
            {item.swatch}
          </span>
          {item.label}
        </li>
      ))}
    </ul>
  );
}

/**
 * An annual budget account's year: each month's spending as bars, the running total as a
 * line, the annual budget as a horizontal line and the even pace (budget × month / 12) as
 * a dashed line. Months after the selected one are left empty. Clicking a month calls
 * `onSelect`; the page ignores months outside its window.
 */
export function AnnualTrendChart({
  account,
  currency,
  year,
  selected,
  onSelect,
  className,
}: {
  account: Schemas["AnnualAccount"];
  currency: string;
  year: number;
  selected: string;
  onSelect: (month: string) => void;
  className?: string;
}) {
  const compact = useMediaQuery("(max-width: 639px)");
  const { hidden } = usePrivacy();
  const points = annualTrendPoints(year, account.months, account.budget);
  const budget = account.budget === null ? null : toChartNumber(account.budget);
  const ticks = niceTicksOf(
    points.flatMap((point) => [point.actual ?? 0, point.cumulative ?? 0, point.pace ?? 0, budget ?? 0]),
  );

  return (
    <section className={cn("flex flex-col rounded-xl border bg-card p-5 shadow-card", className)}>
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div>
          <h2 className="text-base font-semibold">{A.title(year)}</h2>
          <p className="text-xs text-muted-foreground">{A.description}</p>
        </div>
        <Legend budget={budget !== null} />
      </div>
      <ChartContainer
        config={config}
        role="img"
        aria-label={A.ariaLabel(year)}
        className="mt-4 aspect-auto h-56 min-h-56 w-full flex-1 cursor-pointer [&_.recharts-bar-rectangle]:pointer-events-none [&_.recharts-line]:pointer-events-none"
      >
        <ComposedChart data={points} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
          <MonthColumns points={points} selected={selected} layer="band" />
          <XAxis
            dataKey="month"
            tickLine={false}
            axisLine={false}
            interval={0}
            height={36}
            tick={(props: Omit<TickProps, "points" | "selected" | "compact">) => (
              <MonthTick {...props} points={points} selected={selected} compact={compact} />
            )}
          />
          <YAxis
            tickLine={false}
            axisLine={false}
            width={compact ? 46 : 54}
            ticks={ticks}
            domain={ticks ? [0, ticks.at(-1)!] : undefined}
            fontSize={compact ? 11 : 12}
            tickFormatter={(value: number) => (hidden ? S.privacy.hiddenTick : formatMoneyCompact(value, currency))}
            className="num"
          />
          <ChartTooltip
            cursor={{ fill: "var(--muted)", fillOpacity: 0.7 }}
            content={
              <ChartTooltipContent
                className="num min-w-44"
                labelFormatter={(_, payload) => {
                  const point = payload?.[0]?.payload as AnnualTrendPoint | undefined;
                  return point ? T.month.long(point.year, point.monthNumber) : null;
                }}
                formatter={(_value, name, item) => {
                  const point = item.payload as AnnualTrendPoint;
                  if (name === "pace") return null;
                  const text = name === "actual" ? point.actualText : point.cumulativeText;
                  if (text === null) return null;
                  return (
                    <div className="flex w-full items-center justify-between gap-4">
                      <span className="flex items-center gap-1.5 text-muted-foreground">
                        <span
                          aria-hidden="true"
                          className="size-2 rounded-[2px]"
                          style={{ background: name === "actual" ? "var(--color-actual)" : "var(--color-cumulative)" }}
                        />
                        {name === "actual" ? A.legendMonth : A.legendCumulative}
                      </span>
                      <span className="amount font-medium">{formatMoney(text, currency)}</span>
                    </div>
                  );
                }}
              />
            }
          />
          {budget !== null ? (
            <ReferenceLine y={budget} stroke="var(--color-budget)" strokeWidth={1.5} ifOverflow="extendDomain" />
          ) : null}
          <Bar
            dataKey="actual"
            fill="var(--color-actual)"
            barSize={compact ? 8 : 16}
            radius={[3, 3, 0, 0]}
            isAnimationActive={false}
          />
          {budget !== null ? (
            <Line
              dataKey="pace"
              stroke="var(--color-pace)"
              strokeDasharray="4 4"
              strokeWidth={1.5}
              dot={false}
              activeDot={false}
              isAnimationActive={false}
            />
          ) : null}
          <Line
            dataKey="cumulative"
            stroke="var(--color-cumulative)"
            strokeWidth={2}
            dot={{ r: 2.5, fill: "var(--color-cumulative)" }}
            connectNulls={false}
            isAnimationActive={false}
          />
          <MonthColumns points={points} selected={selected} onSelect={onSelect} layer="hit" />
        </ComposedChart>
      </ChartContainer>
    </section>
  );
}
