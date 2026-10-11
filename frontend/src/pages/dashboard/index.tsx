import { useQuery } from "@tanstack/react-query";
import { cn } from "cn";
import { InboxIcon } from "lucide-react";
import { useState } from "react";

import { type BudgetScope, monthDetailQuery, monthlySummaryQuery } from "@/api/queries";
import { BudgetAccountSelect } from "@/components/budget-account-select";
import { ErrorState } from "@/components/error-state";
import { Skeleton } from "@/components/ui/skeleton";
import { useBudgetScope } from "@/hooks/use-search-state";
import { addMonths, isMonth, monthOf } from "@/lib/month";
import { S } from "@/strings.zh";

import { CategoryTable } from "./category-table";
import { isWindowEmpty } from "./model";
import { MonthSummary } from "./month-summary";
import { ShareChart } from "./share-chart";
import { TrendChart } from "./trend-chart";

const T = S.dashboard;
const WINDOW_MONTHS = 12;

function DashboardSkeleton() {
  return (
    <div role="status" aria-label={S.common.loading} className="grid gap-5 lg:grid-cols-3">
      <Skeleton className="h-80 rounded-xl" />
      <Skeleton className="h-80 rounded-xl lg:col-span-2" />
      <Skeleton className="h-96 rounded-xl lg:col-span-2" />
      <Skeleton className="h-96 rounded-xl" />
    </div>
  );
}

function EmptyState({ scoped }: { scoped: boolean }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed bg-card px-6 py-16 text-center">
      <span className="flex size-11 items-center justify-center rounded-full bg-accent text-accent-foreground">
        <InboxIcon className="size-5" />
      </span>
      <h2 className="text-base font-semibold">{T.empty.title}</h2>
      <p className="max-w-md text-muted-foreground">{T.empty.body}</p>
      <p className="text-xs text-muted-foreground">{scoped ? T.empty.windowScoped : T.empty.window}</p>
    </div>
  );
}

function DashboardBody({
  scope,
  month,
  firstMonth,
  lastMonth,
  onMonthChange,
  now,
}: {
  scope: BudgetScope;
  month: string;
  firstMonth: string;
  lastMonth: string;
  onMonthChange: (month: string) => void;
  now: Date;
}) {
  const summary = useQuery(monthlySummaryQuery(scope, firstMonth, lastMonth));
  const detail = useQuery({
    ...monthDetailQuery(scope, month),
    // Keep the previous month on screen while the next one loads, but never another
    // scope's figures: they would be read as this budget account's.
    placeholderData: (previous) => (previous?.budget_account_id === scope ? previous : undefined),
  });

  if (summary.isLoadingError || detail.isLoadingError) {
    return (
      <ErrorState
        title={S.errors.loadFailedTitle}
        // Not `summary.error ?? ...`: a summary whose background refetch failed still has
        // data and an error, but it is the month detail that failed to load.
        error={summary.isLoadingError ? summary.error : detail.error}
        onRetry={() => {
          void summary.refetch();
          void detail.refetch();
        }}
      />
    );
  }
  if (!summary.data || !detail.data) return <DashboardSkeleton />;
  if (isWindowEmpty(summary.data.months)) return <EmptyState scoped={scope !== null} />;

  return (
    <div
      className={cn(
        "grid gap-5 transition-opacity lg:grid-cols-3",
        detail.isPlaceholderData && "opacity-60",
      )}
      aria-busy={detail.isPlaceholderData}
    >
      <MonthSummary
        detail={detail.data}
        month={month}
        firstMonth={firstMonth}
        lastMonth={lastMonth}
        onMonthChange={onMonthChange}
        now={now}
      />
      <TrendChart
        summary={summary.data}
        selected={month}
        onSelect={onMonthChange}
        className="lg:col-span-2"
      />
      <CategoryTable detail={detail.data} className="lg:col-span-2 lg:self-start" />
      <ShareChart detail={detail.data} className="lg:self-start" />
    </div>
  );
}

/**
 * All budget accounts together ("全部", the default) or one of them: a budget account's
 * view holds only its level-2 categories and their level-1 parents. Payment channels play
 * no part here. The scope and the month live in the URL (`?scope=<id>&month=YYYY-MM`), so
 * a view can be reloaded or bookmarked.
 */
export function DashboardPage() {
  const [now] = useState(() => new Date());
  const { budgetAccounts, scope, params, update } = useBudgetScope();

  const lastMonth = monthOf(now);
  const firstMonth = addMonths(lastMonth, -(WINDOW_MONTHS - 1));
  const requested = params.get("month");
  const month =
    isMonth(requested) && requested >= firstMonth && requested <= lastMonth ? requested : lastMonth;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-lg font-semibold tracking-tight">{T.title}</h1>
        {budgetAccounts.data && scope !== undefined ? (
          <BudgetAccountSelect
            budgetAccounts={budgetAccounts.data}
            value={scope}
            onChange={(next) => update({ scope: next })}
          />
        ) : null}
      </div>
      {budgetAccounts.isLoadingError ? (
        <ErrorState
          title={S.errors.loadFailedTitle}
          error={budgetAccounts.error}
          onRetry={() => void budgetAccounts.refetch()}
        />
      ) : scope !== undefined ? (
        <DashboardBody
          key={scope ?? "all"}
          scope={scope}
          month={month}
          firstMonth={firstMonth}
          lastMonth={lastMonth}
          onMonthChange={(next) => update({ month: next })}
          now={now}
        />
      ) : (
        <DashboardSkeleton />
      )}
    </div>
  );
}
