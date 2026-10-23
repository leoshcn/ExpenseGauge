import { cn } from "cn";
import { Link } from "react-router";

import type { Schemas } from "@/api/client";
import { formatDay } from "@/lib/date";
import { formatMoney, formatNumberCompact, fromCents, toCents, toChartNumber } from "@/lib/money";
import { S } from "@/strings.zh";

import { calendarWeeks, heatLevel } from "./model";

const T = S.reports.calendar;

/** Background of each heat level: the brand colour at increasing strength. */
const HEAT = ["bg-card", "bg-primary/10", "bg-primary/25", "bg-primary/45", "bg-primary/70"] as const;

/**
 * The month as a calendar: each day shaded by how much was spent (net, by effective day)
 * and linked to that day's transactions.
 */
export function SpendingCalendar({
  daily,
  month,
  now,
}: {
  daily: Schemas["DailyOut"];
  month: string;
  now: Date;
}) {
  const amounts = new Map(daily.days.filter((day) => day.date.startsWith(month)).map((day) => [day.date, day.amount]));
  const max = Math.max(0, ...[...amounts.values()].map(toCents));
  const total = fromCents([...amounts.values()].reduce((sum, amount) => sum + toCents(amount), 0));
  const money = (value: string) => formatMoney(value, daily.currency);
  return (
    <section className="rounded-xl border bg-card p-4 shadow-card sm:p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold">{T.title}</h2>
          <p className="text-xs text-muted-foreground">{T.description}</p>
        </div>
        <p className="num amount text-sm font-medium">{T.total(money(total))}</p>
      </div>
      <div className="mt-4 grid grid-cols-7 gap-1 sm:gap-1.5">
        {T.weekdays.map((weekday) => (
          <div key={weekday} aria-hidden="true" className="pb-1 text-center text-xs text-muted-foreground">
            {weekday}
          </div>
        ))}
        {calendarWeeks(month).flatMap((week, row) =>
          week.map((date, column) => {
            if (date === null) return <div key={`${row}-${column}`} />;
            const amount = amounts.get(date);
            const level = heatLevel(amount, max);
            const day = formatDay(date, now);
            return (
              <Link
                key={date}
                to={`/transactions?from=${date}&to=${date}`}
                aria-label={amount ? T.dayLabel(day, money(amount)) : T.noSpending(day)}
                title={amount ? T.dayLabel(day, money(amount)) : T.noSpending(day)}
                className={cn(
                  "flex min-h-14 flex-col justify-between rounded-md border p-1.5 outline-none transition-colors hover:border-primary focus-visible:ring-[3px] focus-visible:ring-ring/50 sm:min-h-20 sm:p-2",
                  HEAT[level],
                  level >= 4 && "text-primary-foreground",
                )}
              >
                <span className="num text-xs">{Number(date.slice(8))}</span>
                {amount ? (
                  <span className="num amount truncate text-right text-[10px] font-medium sm:text-xs">
                    {/* Narrow cells get the abbreviated figure; the label has the full one. */}
                    <span className="sm:hidden">{formatNumberCompact(toChartNumber(amount))}</span>
                    <span className="hidden sm:inline">{money(amount)}</span>
                  </span>
                ) : null}
              </Link>
            );
          }),
        )}
      </div>
    </section>
  );
}
