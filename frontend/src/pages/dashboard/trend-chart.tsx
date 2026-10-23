import { cn } from "cn";
import { Bar, BarChart, CartesianGrid, Rectangle, usePlotArea, XAxis, YAxis } from "recharts";

import type { Schemas } from "@/api/client";
import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import { useMediaQuery } from "@/hooks/use-media-query";
import { usePrivacy } from "@/hooks/use-privacy";
import { formatMoney, formatMoneyCompact } from "@/lib/money";
import { S } from "@/strings.zh";

import { hasAnnual, niceTicks, type TrendPoint, trendPoints } from "./model";

const T = S.dashboard;

const config = {
  budget: { label: T.trend.legendBudget, color: "var(--chart-budget)" },
  actual: { label: T.trend.legendActual, color: "var(--chart-actual)" },
  over: { label: T.trend.legendOver, color: "var(--chart-over)" },
  annual: { label: T.trend.legendAnnual, color: "var(--chart-annual)" },
} satisfies ChartConfig;

/** What month ticks and click targets need of a point. */
type MonthPoint = Pick<TrendPoint, "month" | "monthNumber" | "year">;

function Legend({ annual }: { annual: boolean }) {
  const items = [
    { key: "budget", label: T.trend.legendBudget, swatch: "bg-chart-budget h-3 w-3" },
    { key: "actual", label: T.trend.legendActual, swatch: "bg-chart-actual h-3 w-1.5" },
    { key: "over", label: T.trend.legendOver, swatch: "bg-chart-over h-3 w-1.5" },
    ...(annual ? [{ key: "annual", label: T.trend.legendAnnual, swatch: "bg-chart-annual h-3 w-1.5" }] : []),
  ];
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
      {items.map((item) => (
        <li key={item.key} className="flex items-center gap-1.5">
          <span className={cn("rounded-[2px]", item.swatch)} aria-hidden="true" />
          {item.label}
        </li>
      ))}
    </ul>
  );
}

export type TickProps = {
  x?: number | string;
  y?: number | string;
  index?: number;
  points: MonthPoint[];
  selected: string;
  compact: boolean;
};

/** "10月", with the year under the first tick and under every January. */
export function MonthTick({ x, y, index = 0, points, selected, compact }: TickProps) {
  const point = points[index];
  if (!point) return null;
  const active = point.month === selected;
  return (
    <g transform={`translate(${Number(x)},${Number(y)})`}>
      <text
        dy={12}
        textAnchor="middle"
        className={cn("num", active ? "fill-foreground font-semibold" : "fill-muted-foreground")}
        fontSize={compact ? 11 : 12}
      >
        {compact ? point.monthNumber : T.month.short(point.monthNumber)}
      </text>
      {index === 0 || point.monthNumber === 1 ? (
        <text dy={27} textAnchor="middle" className="num fill-muted-foreground/70" fontSize={11}>
          {compact ? point.year : T.month.year(point.year)}
        </text>
      ) : null}
    </g>
  );
}

/**
 * One full-height column per month, laid out from the plot area. `band` draws the
 * selected month's highlight under the bars; `hit` puts a transparent click target
 * over each month. The chart's own `onClick` is not used: it reports the month of the
 * last hover, which on a tap is the previously touched month.
 */
export function MonthColumns({
  points,
  selected,
  onSelect,
  layer,
}: {
  points: MonthPoint[];
  selected: string;
  onSelect?: (month: string) => void;
  layer: "band" | "hit";
}) {
  const plot = usePlotArea();
  if (!plot || points.length === 0) return null;
  const width = plot.width / points.length;
  return (
    <g>
      {points.map((point, index) => {
        const x = plot.x + width * index;
        if (layer === "hit") {
          return (
            <rect
              key={point.month}
              x={x}
              y={plot.y}
              width={width}
              height={plot.height}
              fill="transparent"
              onClick={() => onSelect?.(point.month)}
            />
          );
        }
        return point.month === selected ? (
          <rect
            key={point.month}
            x={x + 1}
            y={plot.y}
            width={width - 2}
            height={plot.height}
            rx={6}
            fill="var(--accent)"
          />
        ) : null;
      })}
    </g>
  );
}

/**
 * Twelve months of budget against actual, as bullet bars: the budget is a wide pale bar
 * and the actual a narrow solid one inside it, so "over" reads as the solid bar breaking
 * out of the pale one. Over-budget months are vermilion. Clicking a month selects it.
 */
export function TrendChart({
  summary,
  selected,
  onSelect,
  description = T.trend.description,
  className,
}: {
  summary: Schemas["MonthlySummaryOut"];
  selected: string;
  onSelect: (month: string) => void;
  /** What a click on a month does. */
  description?: string;
  className?: string;
}) {
  const compact = useMediaQuery("(max-width: 639px)");
  const { hidden } = usePrivacy();
  const points = trendPoints(summary.months);
  const ticks = niceTicks(points);
  // Annual accounts' spending is stacked on the monthly actual ("全部" only); it is not
  // compared with the budget, which is monthly.
  const annual = hasAnnual(points);
  const budgetSize = compact ? 14 : 28;
  const actualSize = compact ? 6 : 12;

  return (
    <section className={cn("flex flex-col rounded-xl border bg-card p-5 shadow-card", className)}>
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div>
          <h2 className="text-base font-semibold">{T.trend.title}</h2>
          <p className="text-xs text-muted-foreground">{description}</p>
        </div>
        <Legend annual={annual} />
      </div>
      <ChartContainer
        config={config}
        role="img"
        aria-label={T.trend.ariaLabel}
        // Bars are drawn above the click targets of `MonthColumns`, so they let clicks through.
        className="mt-4 aspect-auto h-56 min-h-56 w-full flex-1 cursor-pointer [&_.recharts-bar-rectangle]:pointer-events-none"
      >
        <BarChart
          data={points}
          // Two bars of different widths share one centre when the gap between them is
          // minus the mean of their widths.
          barGap={-(budgetSize + actualSize) / 2}
          margin={{ top: 4, right: 0, bottom: 0, left: 0 }}
        >
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
            tickFormatter={(value: number) => (hidden ? S.privacy.hiddenTick : formatMoneyCompact(value, summary.currency))}
            className="num"
          />
          <ChartTooltip
            cursor={{ fill: "var(--muted)", fillOpacity: 0.7 }}
            content={
              <ChartTooltipContent
                className="num min-w-44"
                labelFormatter={(_, payload) => {
                  const point = payload?.[0]?.payload as TrendPoint | undefined;
                  return point ? T.month.long(point.year, point.monthNumber) : null;
                }}
                formatter={(_value, name, item) => {
                  const point = item.payload as TrendPoint;
                  const isBudget = name === "budget";
                  const isAnnual = name === "annual";
                  const text = isBudget ? point.budgetText : isAnnual ? point.annualText : point.actualText;
                  return (
                    <div className="flex w-full items-center justify-between gap-4">
                      <span className="flex items-center gap-1.5 text-muted-foreground">
                        <span
                          aria-hidden="true"
                          className="size-2 rounded-[2px]"
                          style={{
                            background: isBudget
                              ? "var(--color-budget)"
                              : isAnnual
                                ? "var(--color-annual)"
                                : point.over
                                  ? "var(--color-over)"
                                  : "var(--color-actual)",
                          }}
                        />
                        {isBudget ? T.trend.legendBudget : isAnnual ? T.trend.legendAnnual : T.trend.legendActual}
                      </span>
                      <span className={cn("amount font-medium", name === "actual" && point.over && "text-over")}>
                        {text === null ? T.summary.noBudget : formatMoney(text, summary.currency)}
                      </span>
                    </div>
                  );
                }}
              />
            }
          />
          <Bar
            dataKey="budget"
            fill="var(--color-budget)"
            barSize={budgetSize}
            radius={[4, 4, 0, 0]}
            isAnimationActive={false}
          />
          <Bar
            dataKey="actual"
            barSize={actualSize}
            radius={[3, 3, 0, 0]}
            stackId={annual ? "spending" : undefined}
            isAnimationActive={false}
            shape={(props) => (
              <Rectangle
                {...props}
                // Square top when the annual segment sits on it.
                radius={(points[props.index]?.annual ?? 0) > 0 ? 0 : props.radius}
                fill={points[props.index]?.over ? "var(--color-over)" : "var(--color-actual)"}
              />
            )}
          />
          {annual ? (
            <Bar
              dataKey="annual"
              stackId="spending"
              barSize={actualSize}
              radius={[3, 3, 0, 0]}
              fill="var(--color-annual)"
              isAnimationActive={false}
            />
          ) : null}
          <MonthColumns points={points} selected={selected} onSelect={onSelect} layer="hit" />
        </BarChart>
      </ChartContainer>
    </section>
  );
}
