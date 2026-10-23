import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { useState } from "react";

import { type BudgetScope, reportDailyQuery } from "@/api/queries";
import { BudgetAccountSelect } from "@/components/budget-account-select";
import { ErrorState } from "@/components/error-state";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useMonthHotkeys } from "@/hooks/use-hotkey";
import { useBudgetScope } from "@/hooks/use-search-state";
import { formatMonth } from "@/lib/date";
import { addMonths, isMonth, monthOf } from "@/lib/month";
import { S } from "@/strings.zh";

import { CustomReport } from "./custom-report";
import { configParams, readConfig } from "./model";
import { PaceChart } from "./pace-chart";
import { SpendingCalendar } from "./spending-calendar";

const T = S.reports;
const TABS = ["custom", "pace", "calendar"] as const;
type Tab = (typeof TABS)[number];
/** Months before the chosen one that the pace comparison needs. */
const PACE_MONTHS = 3;

function MonthStepper({ month, current, onChange }: { month: string; current: string; onChange: (month: string) => void }) {
  return (
    <div className="flex items-center gap-2">
      <Button variant="outline" size="icon-sm" aria-label={S.budgets.month.previous} onClick={() => onChange(addMonths(month, -1))}>
        <ChevronLeftIcon />
      </Button>
      <span className="num min-w-24 text-center font-medium" aria-live="polite">
        {formatMonth(month)}
      </span>
      <Button
        variant="outline"
        size="icon-sm"
        aria-label={S.budgets.month.next}
        disabled={month >= current}
        onClick={() => onChange(addMonths(month, 1))}
      >
        <ChevronRightIcon />
      </Button>
      {month !== current ? (
        <Button variant="ghost" size="sm" onClick={() => onChange(current)}>
          {S.budgets.month.current}
        </Button>
      ) : null}
    </div>
  );
}

/** The month's daily spending, shared by the pace chart and the calendar. */
function DailyViews({ tab, scope, month, now }: { tab: "pace" | "calendar"; scope: BudgetScope; month: string; now: Date }) {
  const daily = useQuery({
    ...reportDailyQuery(addMonths(month, -PACE_MONTHS), month, scope),
    placeholderData: keepPreviousData,
  });
  if (daily.isLoadingError) {
    return <ErrorState title={S.errors.loadFailedTitle} error={daily.error} onRetry={() => void daily.refetch()} />;
  }
  if (!daily.data) return <Skeleton role="status" aria-label={S.common.loading} className="h-96 rounded-xl" />;
  return tab === "pace" ? (
    <PaceChart daily={daily.data} month={month} now={now} />
  ) : (
    <SpendingCalendar daily={daily.data} month={month} now={now} />
  );
}

/**
 * Reports: a custom report (grouping, range and chart chosen by the user, savable), the
 * month's cumulative spending against earlier months, and a calendar of daily spending.
 * Everything lives in the URL (`?tab&scope&month&group&mode&range&from&to&chart&saved`).
 */
export function ReportsPage() {
  const [now] = useState(() => new Date());
  const { budgetAccounts, scope, params, update } = useBudgetScope();
  const requestedTab = params.get("tab");
  const tab: Tab = TABS.find((value) => value === requestedTab) ?? "custom";
  const current = monthOf(now);
  const requestedMonth = params.get("month");
  const month = isMonth(requestedMonth) && requestedMonth <= current ? requestedMonth : current;
  const onMonthChange = (next: string) => update({ month: next === current ? null : next });
  useMonthHotkeys({ month, current, onChange: onMonthChange, max: current });
  const config = readConfig(params);
  const savedParam = Number(params.get("saved"));
  const savedId = Number.isInteger(savedParam) && savedParam > 0 ? savedParam : null;

  let body: React.ReactNode;
  if (budgetAccounts.isLoadingError) {
    body = <ErrorState title={S.errors.loadFailedTitle} error={budgetAccounts.error} onRetry={() => void budgetAccounts.refetch()} />;
  } else if (scope === undefined) {
    body = <Skeleton role="status" aria-label={S.common.loading} className="h-96 rounded-xl" />;
  } else {
    body = (
      <>
        <TabsContent value="custom">
          <CustomReport
            config={{ ...config, budget_account_id: scope }}
            scope={scope}
            savedId={savedId}
            now={now}
            onChange={(next) => update(next)}
            onSelectSaved={(report) => {
              if (report === null) {
                update({ saved: null });
                return;
              }
              const known = budgetAccounts.data?.some((account) => account.id === report.config.budget_account_id);
              update({
                ...configParams(report.config),
                scope: known ? (report.config.budget_account_id ?? null) : null,
                saved: report.id,
              });
            }}
          />
        </TabsContent>
        <TabsContent value="pace" className="space-y-4">
          <MonthStepper month={month} current={current} onChange={onMonthChange} />
          <DailyViews tab="pace" scope={scope} month={month} now={now} />
        </TabsContent>
        <TabsContent value="calendar" className="space-y-4">
          <MonthStepper month={month} current={current} onChange={onMonthChange} />
          <DailyViews tab="calendar" scope={scope} month={month} now={now} />
        </TabsContent>
      </>
    );
  }

  return (
    <Tabs value={tab} onValueChange={(next) => update({ tab: next === "custom" ? null : next })} className="gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-lg font-semibold tracking-tight">{T.title}</h1>
        <div className="flex flex-wrap items-center gap-3">
          <TabsList aria-label={T.tabs.label}>
            <TabsTrigger value="custom">{T.tabs.custom}</TabsTrigger>
            <TabsTrigger value="pace">{T.tabs.pace}</TabsTrigger>
            <TabsTrigger value="calendar">{T.tabs.calendar}</TabsTrigger>
          </TabsList>
          {budgetAccounts.data && scope !== undefined ? (
            <BudgetAccountSelect
              budgetAccounts={budgetAccounts.data}
              value={scope}
              onChange={(next) => update({ scope: next })}
            />
          ) : null}
        </div>
      </div>
      {body}
    </Tabs>
  );
}
