import { keepPreviousData, useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { cn } from "cn";
import { InboxIcon } from "lucide-react";
import { useState } from "react";

import type { Schemas } from "@/api/client";
import {
  annualSummaryQuery,
  type BudgetScope,
  keys,
  monthDetailQuery,
  monthlySummaryQuery,
  putBudgets,
  scheduleStatusQuery,
} from "@/api/queries";
import { BudgetAccountSelect } from "@/components/budget-account-select";
import { ErrorState } from "@/components/error-state";
import { Skeleton } from "@/components/ui/skeleton";
import { useGridMonthCount } from "@/hooks/use-grid-month-count";
import { useMonthHotkeys } from "@/hooks/use-hotkey";
import { useBudgetScope } from "@/hooks/use-search-state";
import { yearProgress } from "@/lib/budget";
import { addMonths, isMonth, monthOf } from "@/lib/month";
import { S } from "@/strings.zh";

import { AnnualCard } from "./annual-card";
import { AnnualSummary } from "./annual-summary";
import { AnnualTrendChart } from "./annual-trend-chart";
import { BudgetGrid } from "./budget-grid";
import { CategoryTable } from "./category-table";
import { InsightCard } from "./insight-card";
import { gridMonths, isWindowEmpty } from "./model";
import { MonthBar } from "./month-bar";
import { MonthSummary } from "./month-summary";
import { ScheduleCard } from "./schedule-card";
import { ShareChart } from "./share-chart";

const T = S.dashboard;
const WINDOW_MONTHS = 12;
/** How far ahead a month can be chosen, to plan its budgets. */
const AHEAD_MONTHS = 12;

function DashboardSkeleton() {
  return (
    <div role="status" aria-label={S.common.loading} className="grid gap-5 lg:grid-cols-3">
      <Skeleton className="h-44 rounded-xl lg:col-span-2" />
      <Skeleton className="h-44 rounded-xl" />
      <Skeleton className="h-96 rounded-xl lg:col-span-3" />
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

/**
 * "全部" or one monthly budget account: the month against the monthly budgets, and the
 * budget grid of that month and the two before it, where budgets are edited in place. In
 * "全部" annual accounts are left out of that comparison; their spending is shown beside it
 * (`annual_actual`) and, when `withAnnual`, in the annual card.
 */
function DashboardBody({
  scope,
  month,
  firstMonth,
  lastMonth,
  onOpenAccount,
  withAnnual,
  now,
}: {
  scope: BudgetScope;
  month: string;
  firstMonth: string;
  lastMonth: string;
  onOpenAccount: (budgetAccountId: number) => void;
  /** Show the annual card: "全部" with at least one annual budget account. */
  withAnnual: boolean;
  now: Date;
}) {
  const queryClient = useQueryClient();
  // Only for "nothing in the 12-month window yet".
  const summary = useQuery(monthlySummaryQuery(scope, firstMonth, lastMonth));
  // Scheduled expenses: the current month only (the status of past months is history).
  const schedules = useQuery({ ...scheduleStatusQuery(scope, month), enabled: month === lastMonth });
  // The grid's months, oldest first; the last one is the selected month.
  const details = useQueries({
    queries: gridMonths(month).map((each) => ({
      ...monthDetailQuery(scope, each),
      // Keep the previous months on screen while the next ones load, but never another
      // scope's figures: they would be read as this budget account's.
      placeholderData: (previous: Schemas["MonthDetailOut"] | undefined) =>
        previous?.budget_account_id === scope ? previous : undefined,
    })),
  });
  const detail = details[details.length - 1]!;
  // A budget is saved from the month on: later months that follow it change too, so every
  // month's figures (and the budgets page) are refetched.
  const saveBudget = useMutation({
    mutationFn: ({ categoryId, from, amount }: { categoryId: number; from: string; amount: string | null }) =>
      putBudgets({ effective_from: from, items: [{ category_id: categoryId, amount }] }),
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: keys.budgets }),
        queryClient.invalidateQueries({ queryKey: keys.summaries }),
      ]),
  });
  // Only asked for in "全部" (the body is keyed by scope, so the kept result is always that).
  const annual = useQuery({
    ...annualSummaryQuery(null, month),
    enabled: withAnnual,
    placeholderData: keepPreviousData,
  });

  const failedDetail = details.find((each) => each.isLoadingError);
  if (summary.isLoadingError || failedDetail || (withAnnual && annual.isLoadingError)) {
    return (
      <ErrorState
        title={S.errors.loadFailedTitle}
        // Not `summary.error ?? ...`: a summary whose background refetch failed still has
        // data and an error, but it is a month detail that failed to load.
        error={summary.isLoadingError ? summary.error : failedDetail ? failedDetail.error : annual.error}
        onRetry={() => {
          void summary.refetch();
          for (const each of details) void each.refetch();
          if (withAnnual) void annual.refetch();
        }}
      />
    );
  }
  const loaded = details.flatMap((each) => (each.data ? [each.data] : []));
  if (!summary.data || !detail.data || loaded.length < details.length || (withAnnual && !annual.data)) {
    return <DashboardSkeleton />;
  }
  if (isWindowEmpty(summary.data.months)) return <EmptyState scoped={scope !== null} />;

  // The AI insight is about everything, so it is not offered for one budget account; nor
  // for a future month, which has nothing to analyse yet.
  const insight = scope === null && month <= lastMonth;
  const pending = details.some((each) => each.isPlaceholderData) || (withAnnual && annual.isPlaceholderData);

  return (
    <div
      className={cn("grid gap-5 transition-opacity lg:grid-cols-3", pending && "opacity-60")}
      aria-busy={pending}
    >
      <MonthSummary
        detail={detail.data}
        month={month}
        now={now}
        forecast={month === lastMonth ? (schedules.data?.forecast ?? null) : null}
        className={insight ? "lg:col-span-2" : "lg:col-span-3"}
      />
      {insight ? <InsightCard month={month} /> : null}
      <BudgetGrid
        details={loaded}
        current={lastMonth}
        onSave={(categoryId, from, amount) => saveBudget.mutateAsync({ categoryId, from, amount })}
        className="lg:col-span-3"
      />
      {month === lastMonth && schedules.data && schedules.data.items.length > 0 ? (
        <ScheduleCard status={schedules.data} currency={detail.data.currency} now={now} className="lg:col-span-3" />
      ) : null}
      {withAnnual && annual.data && annual.data.accounts.length > 0 ? (
        <AnnualCard summary={annual.data} now={now} onOpen={onOpenAccount} className="lg:col-span-3" />
      ) : null}
    </div>
  );
}

/**
 * One annual budget account through the selected month: year to date against the annual
 * budget, with the year's time progress as the reference instead of the month's.
 */
function AnnualBody({
  scope,
  month,
  firstMonth,
  lastMonth,
  onMonthChange,
  now,
}: {
  scope: number;
  month: string;
  firstMonth: string;
  lastMonth: string;
  onMonthChange: (month: string) => void;
  now: Date;
}) {
  // Keyed by scope, so a kept-over result is always this account's.
  const annual = useQuery({ ...annualSummaryQuery(scope, month), placeholderData: keepPreviousData });

  if (annual.isLoadingError) {
    return (
      <ErrorState
        title={S.errors.loadFailedTitle}
        error={annual.error}
        onRetry={() => void annual.refetch()}
      />
    );
  }
  if (!annual.data) return <DashboardSkeleton />;
  const account = annual.data.accounts[0];
  if (!account) return <EmptyState scoped />;

  const { currency, year } = annual.data;
  const marker = { at: yearProgress(month, now), label: T.annual.marker };
  const table = {
    currency,
    budget: account.budget,
    actual: account.actual,
    count: account.count,
    categories: account.categories,
  };

  return (
    <div
      className={cn(
        "grid gap-5 transition-opacity lg:grid-cols-3",
        annual.isPlaceholderData && "opacity-60",
      )}
      aria-busy={annual.isPlaceholderData}
    >
      <AnnualSummary
        account={account}
        currency={currency}
        through={month}
        now={now}
      />
      <AnnualTrendChart
        account={account}
        currency={currency}
        year={year}
        selected={month}
        onSelect={(next) => (next >= firstMonth && next <= lastMonth ? onMonthChange(next) : undefined)}
        className="lg:col-span-2"
      />
      <CategoryTable detail={table} variant="year" marker={marker} className="lg:col-span-2 lg:self-start" />
      <ShareChart detail={table} variant="year" className="lg:self-start" />
    </div>
  );
}

/**
 * All budget accounts together ("全部", the default) or one of them: a budget account's
 * view holds only its level-2 categories and their level-1 parents. Payment channels play
 * no part here. The scope and the month live in the URL (`?scope=<id>&month=YYYY-MM`), so
 * a view can be reloaded or bookmarked. An annual budget account's view reads the month as
 * "through": its year from January to that month.
 */
export function DashboardPage() {
  const [now] = useState(() => new Date());
  const { budgetAccounts, scope, params, update } = useBudgetScope();

  const lastMonth = monthOf(now);
  const firstMonth = addMonths(lastMonth, -(WINDOW_MONTHS - 1));
  const maxMonth = addMonths(lastMonth, AHEAD_MONTHS);
  const requested = params.get("month");
  const month =
    isMonth(requested) && requested >= firstMonth && requested <= maxMonth ? requested : lastMonth;
  const accounts = budgetAccounts.data ?? [];
  const annualScope = scope != null && accounts.find((account) => account.id === scope)?.period === "year";
  const onMonthChange = (next: string) => update({ month: next });
  const gridMonthCount = useGridMonthCount();
  useMonthHotkeys({ month, current: lastMonth, onChange: onMonthChange, min: firstMonth, max: maxMonth });

  let body;
  if (budgetAccounts.isLoadingError) {
    body = (
      <ErrorState
        title={S.errors.loadFailedTitle}
        error={budgetAccounts.error}
        onRetry={() => void budgetAccounts.refetch()}
      />
    );
  } else if (scope === undefined) {
    body = <DashboardSkeleton />;
  } else if (scope !== null && annualScope) {
    body = (
      <AnnualBody
        key={scope}
        scope={scope}
        month={month}
        firstMonth={firstMonth}
        lastMonth={lastMonth}
        onMonthChange={onMonthChange}
        now={now}
      />
    );
  } else {
    body = (
      <DashboardBody
        key={scope ?? "all"}
        scope={scope}
        month={month}
        firstMonth={firstMonth}
        lastMonth={lastMonth}
        onOpenAccount={(id) => update({ scope: id })}
        withAnnual={scope === null && accounts.some((account) => account.period === "year")}
        now={now}
      />
    );
  }

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
      <MonthBar
        month={month}
        current={lastMonth}
        min={firstMonth}
        max={maxMonth}
        // An annual account's view shows one month ("through"); the grid as many as fit.
        shown={annualScope ? 1 : gridMonthCount}
        onMonthChange={onMonthChange}
        className="rounded-xl border bg-card px-2 py-1.5 shadow-card sm:px-3"
      />
      {body}
    </div>
  );
}
