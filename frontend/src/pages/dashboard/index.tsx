import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { cn } from "cn";
import { InboxIcon } from "lucide-react";
import { useState } from "react";

import { annualSummaryQuery, type BudgetScope, monthDetailQuery, monthlySummaryQuery } from "@/api/queries";
import { BudgetAccountSelect } from "@/components/budget-account-select";
import { ErrorState } from "@/components/error-state";
import { Skeleton } from "@/components/ui/skeleton";
import { useBudgetScope } from "@/hooks/use-search-state";
import { yearProgress } from "@/lib/budget";
import { addMonths, isMonth, monthOf } from "@/lib/month";
import { S } from "@/strings.zh";

import { AnnualCard } from "./annual-card";
import { AnnualSummary } from "./annual-summary";
import { AnnualTrendChart } from "./annual-trend-chart";
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

/**
 * "全部" or one monthly budget account: the month against the monthly budgets. In "全部"
 * annual accounts are left out of that comparison; their spending is shown beside it
 * (`annual_actual`) and, when `withAnnual`, in the annual card.
 */
function DashboardBody({
  scope,
  month,
  firstMonth,
  lastMonth,
  onMonthChange,
  onOpenAccount,
  withAnnual,
  now,
}: {
  scope: BudgetScope;
  month: string;
  firstMonth: string;
  lastMonth: string;
  onMonthChange: (month: string) => void;
  onOpenAccount: (budgetAccountId: number) => void;
  /** Show the annual card: "全部" with at least one annual budget account. */
  withAnnual: boolean;
  now: Date;
}) {
  const summary = useQuery(monthlySummaryQuery(scope, firstMonth, lastMonth));
  const detail = useQuery({
    ...monthDetailQuery(scope, month),
    // Keep the previous month on screen while the next one loads, but never another
    // scope's figures: they would be read as this budget account's.
    placeholderData: (previous) => (previous?.budget_account_id === scope ? previous : undefined),
  });
  // Only asked for in "全部" (the body is keyed by scope, so the kept result is always that).
  const annual = useQuery({
    ...annualSummaryQuery(null, month),
    enabled: withAnnual,
    placeholderData: keepPreviousData,
  });

  if (summary.isLoadingError || detail.isLoadingError || (withAnnual && annual.isLoadingError)) {
    return (
      <ErrorState
        title={S.errors.loadFailedTitle}
        // Not `summary.error ?? ...`: a summary whose background refetch failed still has
        // data and an error, but it is the month detail that failed to load.
        error={summary.isLoadingError ? summary.error : detail.isLoadingError ? detail.error : annual.error}
        onRetry={() => {
          void summary.refetch();
          void detail.refetch();
          if (withAnnual) void annual.refetch();
        }}
      />
    );
  }
  if (!summary.data || !detail.data || (withAnnual && !annual.data)) return <DashboardSkeleton />;
  if (isWindowEmpty(summary.data.months)) return <EmptyState scoped={scope !== null} />;

  const pending = detail.isPlaceholderData || (withAnnual && annual.isPlaceholderData);

  return (
    <div
      className={cn("grid gap-5 transition-opacity lg:grid-cols-3", pending && "opacity-60")}
      aria-busy={pending}
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
      {withAnnual && annual.data && annual.data.accounts.length > 0 ? (
        <AnnualCard summary={annual.data} now={now} onOpen={onOpenAccount} className="lg:col-span-3" />
      ) : null}
      <CategoryTable detail={detail.data} className="lg:col-span-2 lg:self-start" />
      <ShareChart detail={detail.data} className="lg:self-start" />
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
        firstMonth={firstMonth}
        lastMonth={lastMonth}
        onMonthChange={onMonthChange}
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
  const requested = params.get("month");
  const month =
    isMonth(requested) && requested >= firstMonth && requested <= lastMonth ? requested : lastMonth;
  const accounts = budgetAccounts.data ?? [];
  const annualScope = scope != null && accounts.find((account) => account.id === scope)?.period === "year";
  const onMonthChange = (next: string) => update({ month: next });

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
        onMonthChange={onMonthChange}
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
      {body}
    </div>
  );
}
