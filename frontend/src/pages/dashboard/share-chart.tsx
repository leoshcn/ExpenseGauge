import { cn } from "cn";
import { Pie, PieChart } from "recharts";

import type { Schemas } from "@/api/client";
import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import { formatMoney, formatPercent } from "@/lib/money";
import { S } from "@/strings.zh";

import { type ShareSlice, shares } from "./model";

const T = S.dashboard.share;

const sliceName = (slice: ShareSlice) => slice.name ?? T.other;
const sliceColor = (slice: ShareSlice) => `var(--chart-${slice.colorSlot})`;

/**
 * Level-1 categories as shares of the month's spending (or, `variant="year"`, of an annual
 * account's spending since January): a donut and the list it is read from.
 */
export function ShareChart({
  detail,
  variant = "month",
  className,
}: {
  detail: Pick<Schemas["MonthDetailOut"], "currency" | "categories">;
  variant?: "month" | "year";
  className?: string;
}) {
  const copy = variant === "year" ? { ...T, ...S.dashboard.annual.share } : T;
  const { slices, total, excluded } = shares(detail.categories);
  const money = (value: string) => formatMoney(value, detail.currency);
  const config: ChartConfig = Object.fromEntries(
    slices.map((slice) => [slice.key, { label: sliceName(slice), color: sliceColor(slice) }]),
  );
  const data = slices.map((slice) => ({ ...slice, fill: `var(--color-${slice.key})` }));

  return (
    <section className={cn("rounded-xl border bg-card p-5 shadow-card", className)}>
      <h2 className="text-base font-semibold">{T.title}</h2>
      <p className="text-xs text-muted-foreground">{copy.description}</p>

      {slices.length === 0 ? (
        <div className="flex h-48 items-center justify-center text-muted-foreground">{copy.empty}</div>
      ) : (
        <div className="mt-4 flex flex-col gap-5 sm:flex-row sm:items-center lg:flex-col lg:items-stretch">
          <div className="relative mx-auto size-44 shrink-0">
            <ChartContainer config={config} role="img" aria-label={T.ariaLabel} className="size-full">
              <PieChart>
                <ChartTooltip
                  content={
                    <ChartTooltipContent
                      hideLabel
                      className="num"
                      formatter={(_value, _name, item) => {
                        const slice = item.payload as ShareSlice;
                        return (
                          <div className="flex w-full items-center justify-between gap-4">
                            <span className="flex items-center gap-1.5 text-muted-foreground">
                              <span
                                aria-hidden="true"
                                className="size-2 rounded-[2px]"
                                style={{ background: sliceColor(slice) }}
                              />
                              {sliceName(slice)}
                            </span>
                            <span className="amount font-medium">{money(slice.amount)}</span>
                          </div>
                        );
                      }}
                    />
                  }
                />
                <Pie
                  data={data}
                  dataKey="value"
                  nameKey="key"
                  innerRadius="70%"
                  outerRadius="100%"
                  paddingAngle={slices.length > 1 ? 2 : 0}
                  cornerRadius={3}
                  startAngle={90}
                  endAngle={-270}
                  strokeWidth={0}
                  isAnimationActive={false}
                />
              </PieChart>
            </ChartContainer>
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center px-6 text-center">
              <span className="text-xs text-muted-foreground">{T.total}</span>
              <span className="num amount max-w-full truncate text-base font-semibold">{money(total)}</span>
            </div>
          </div>

          <ul className="min-w-0 flex-1 space-y-2">
            {slices.map((slice) => (
              <li key={slice.key} className="flex items-center gap-2">
                <span
                  aria-hidden="true"
                  className="size-2.5 shrink-0 rounded-[3px]"
                  style={{ background: sliceColor(slice) }}
                />
                <span className="min-w-0 flex-1 truncate">{sliceName(slice)}</span>
                <span className="num w-12 text-right text-xs text-muted-foreground">
                  {formatPercent(slice.share, true)}
                </span>
                <span className="num amount w-24 text-right font-medium">{money(slice.amount)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {excluded > 0 ? <p className="mt-4 text-xs text-muted-foreground">{T.excluded}</p> : null}
    </section>
  );
}
