import { cn } from "cn";
import { CalendarClockIcon, CheckIcon, ClockIcon, TriangleAlertIcon } from "lucide-react";
import { Link } from "react-router";

import type { Schemas } from "@/api/client";
import { ScheduleWhen } from "@/components/schedule-when";
import { formatDay } from "@/lib/date";
import { formatMoney } from "@/lib/money";
import { S } from "@/strings.zh";

const T = S.dashboard.schedules;

const STATUS = {
  paid: { icon: CheckIcon, chip: "bg-positive-soft text-positive", label: T.status.paid },
  pending: { icon: ClockIcon, chip: "border text-muted-foreground", label: T.status.pending },
  overdue: { icon: TriangleAlertIcon, chip: "bg-over-soft text-over", label: T.status.overdue },
} satisfies Record<Schemas["ScheduleStatusItem"]["status"], unknown>;

/**
 * This month's scheduled expenses: which have arrived, which are still to come, and which
 * are overdue (no matching payment 3 days after the due date: the agent may have missed
 * it). An overdue row links to a search for its keyword. Shown for the current month only.
 */
export function ScheduleCard({
  status,
  currency,
  now,
  className,
}: {
  status: Schemas["ScheduleStatusOut"];
  currency: string;
  now: Date;
  className?: string;
}) {
  const counts = { paid: 0, pending: 0, overdue: 0 };
  for (const item of status.items) counts[item.status] += 1;
  return (
    <section className={cn("overflow-hidden rounded-xl border bg-card shadow-card", className)}>
      <div className="flex flex-wrap items-start justify-between gap-3 px-4 py-4 sm:px-5">
        <div>
          <h2 className="flex items-center gap-2 text-base font-semibold">
            <CalendarClockIcon className="size-4 text-primary" aria-hidden="true" />
            {T.title}
          </h2>
          <p className="num text-xs text-muted-foreground">{T.counts(counts.paid, counts.pending, counts.overdue)}</p>
        </div>
        <Link to="/settings?tab=schedules" className="text-xs text-muted-foreground underline-offset-4 hover:underline">
          {T.manage}
        </Link>
      </div>
      <ul className="grid border-t sm:grid-cols-2 xl:grid-cols-3">
        {status.items.map((item) => {
          const state = STATUS[item.status];
          return (
            <li
              key={item.schedule.id}
              className={cn(
                "flex items-center gap-3 border-b px-4 py-3 sm:border-r sm:px-5",
                item.status === "overdue" && "shadow-[inset_3px_0_0_var(--over)]",
              )}
            >
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{item.schedule.name}</p>
                <p className="num truncate text-xs text-muted-foreground">
                  {item.transaction
                    ? T.paidOn(formatDay(item.transaction.date, now))
                    : T.dueOn(formatDay(item.due_date, now))}
                  {" · "}
                  <ScheduleWhen schedule={item.schedule} />
                </p>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1">
                <span className="num amount text-sm font-medium">
                  {formatMoney(item.transaction?.amount ?? item.schedule.amount, currency)}
                </span>
                {item.status === "overdue" ? (
                  <Link
                    to={`/transactions?q=${encodeURIComponent(item.schedule.keyword)}`}
                    title={T.overdueHint}
                    className={cn("inline-flex items-center gap-1 rounded-full px-1.5 text-[11px] leading-[1.125rem] font-medium", state.chip)}
                  >
                    <state.icon className="size-3" aria-hidden="true" />
                    {state.label}
                  </Link>
                ) : (
                  <span className={cn("inline-flex items-center gap-1 rounded-full px-1.5 text-[11px] leading-[1.125rem] font-medium", state.chip)}>
                    <state.icon className="size-3" aria-hidden="true" />
                    {state.label}
                  </span>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
