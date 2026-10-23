import { cn } from "cn";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { addMonths, monthRange, parseMonth } from "@/lib/month";
import { S } from "@/strings.zh";

const T = S.dashboard;

/**
 * The Dashboard's months in one row, as at the top of Actual Budget's budget page: the
 * 12-month window with a year label where a year starts, the months on screen (`shown`,
 * ending at the selected one) drawn as one highlighted block, the current month in
 * bold. A click selects a month; the arrows step one month. On phones the months show
 * their number only.
 */
export function MonthBar({
  month,
  firstMonth,
  lastMonth,
  shown,
  onMonthChange,
  className,
}: {
  month: string;
  firstMonth: string;
  /** The current month, the last of the window. */
  lastMonth: string;
  /** How many months up to `month` are on screen. */
  shown: number;
  onMonthChange: (month: string) => void;
  className?: string;
}) {
  const months = monthRange(firstMonth, lastMonth);
  const from = addMonths(month, -(shown - 1));
  const inView = (each: string) => each >= from && each <= month;

  return (
    <nav aria-label={T.monthBar.label} className={cn("flex items-center gap-1 sm:gap-2", className)}>
      <Button
        variant="ghost"
        size="icon-sm"
        className="size-6 sm:size-8"
        disabled={month <= firstMonth}
        onClick={() => onMonthChange(addMonths(month, -1))}
        aria-label={T.month.previous}
      >
        <ChevronLeftIcon />
      </Button>
      <ol className="flex min-w-0 flex-1 items-end justify-between sm:justify-center">
        {months.map((each, index) => {
          const { year, month: number } = parseMonth(each);
          const yearStart = index === 0 || number === 1;
          const selected = each === month;
          const highlighted = inView(each);
          return (
            <li key={each} className="flex flex-col items-center">
              <span className="num h-4 text-[10px] leading-4 text-muted-foreground sm:text-[11px]">
                {yearStart ? T.monthBar.year(year) : null}
              </span>
              <button
                type="button"
                onClick={() => onMonthChange(each)}
                aria-label={T.month.long(year, number)}
                aria-pressed={selected}
                aria-current={each === lastMonth ? "date" : undefined}
                className={cn(
                  "num h-7 min-w-[1.375rem] px-0.5 text-xs outline-none transition-colors hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-ring/50 sm:min-w-10 sm:px-2 sm:text-[13px]",
                  // The months on screen read as one block, rounded at its ends only.
                  highlighted && "bg-accent text-accent-foreground hover:bg-accent",
                  highlighted && !inView(addMonths(each, -1)) && "rounded-l-md",
                  highlighted && !inView(addMonths(each, 1)) && "rounded-r-md",
                  !highlighted && "rounded-md text-muted-foreground",
                  selected && "font-semibold",
                  each === lastMonth && "underline decoration-2 underline-offset-4",
                )}
              >
                <span className="sm:hidden">{number}</span>
                <span className="hidden sm:inline">{T.month.short(number)}</span>
              </button>
            </li>
          );
        })}
      </ol>
      <Button
        variant="ghost"
        size="icon-sm"
        className="size-6 sm:size-8"
        disabled={month >= lastMonth}
        onClick={() => onMonthChange(addMonths(month, 1))}
        aria-label={T.month.next}
      >
        <ChevronRightIcon />
      </Button>
    </nav>
  );
}
