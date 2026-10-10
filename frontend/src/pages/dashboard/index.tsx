import { useQuery } from "@tanstack/react-query";
import { cn } from "cn";
import { InboxIcon } from "lucide-react";
import { useState } from "react";
import { useSearchParams } from "react-router";

import type { Schemas } from "@/api/client";
import { accountsQuery, monthDetailQuery, monthlySummaryQuery } from "@/api/queries";
import { AccountSelect } from "@/components/account-select";
import { ErrorState } from "@/components/error-state";
import { Skeleton } from "@/components/ui/skeleton";
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

function EmptyState() {
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed bg-card px-6 py-16 text-center">
      <span className="flex size-11 items-center justify-center rounded-full bg-accent text-accent-foreground">
        <InboxIcon className="size-5" />
      </span>
      <h2 className="text-base font-semibold">{T.empty.title}</h2>
      <p className="max-w-md text-muted-foreground">{T.empty.body}</p>
      <p className="text-xs text-muted-foreground">{T.empty.window}</p>
    </div>
  );
}

function DashboardBody({
  account,
  month,
  firstMonth,
  lastMonth,
  onMonthChange,
  now,
}: {
  account: Schemas["AccountOut"];
  month: string;
  firstMonth: string;
  lastMonth: string;
  onMonthChange: (month: string) => void;
  now: Date;
}) {
  const summary = useQuery(monthlySummaryQuery(account.id, firstMonth, lastMonth));
  const detail = useQuery({
    ...monthDetailQuery(account.id, month),
    // Keep the previous month on screen while the next one loads, but never another
    // account's figures: they would be shown in the wrong currency.
    placeholderData: (previous) => (previous?.account_id === account.id ? previous : undefined),
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
  if (isWindowEmpty(summary.data.months)) return <EmptyState />;

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
 * One account at a time (accounts have different currencies and are never summed).
 * The account and the month live in the URL, so a view can be reloaded or bookmarked.
 */
export function DashboardPage() {
  const [now] = useState(() => new Date());
  const [params, setParams] = useSearchParams();
  const accounts = useQuery(accountsQuery);

  const lastMonth = monthOf(now);
  const firstMonth = addMonths(lastMonth, -(WINDOW_MONTHS - 1));
  const requested = params.get("month");
  const month =
    isMonth(requested) && requested >= firstMonth && requested <= lastMonth ? requested : lastMonth;
  const account =
    accounts.data?.find((candidate) => String(candidate.id) === params.get("account")) ??
    accounts.data?.[0];

  function update(next: { account?: number; month?: string }) {
    setParams(
      (current) => {
        const merged = new URLSearchParams(current);
        if (next.account !== undefined) merged.set("account", String(next.account));
        if (next.month !== undefined) merged.set("month", next.month);
        return merged;
      },
      { replace: true },
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-lg font-semibold tracking-tight">{T.title}</h1>
        {accounts.data && account ? (
          <AccountSelect
            accounts={accounts.data}
            value={account.id}
            onChange={(id) => update({ account: id })}
          />
        ) : null}
      </div>
      {accounts.isLoadingError ? (
        <ErrorState
          title={S.errors.loadFailedTitle}
          error={accounts.error}
          onRetry={() => void accounts.refetch()}
        />
      ) : account ? (
        <DashboardBody
          key={account.id}
          account={account}
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
