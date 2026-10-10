import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { cn } from "cn";
import { CalendarClockIcon, ChevronLeftIcon, ChevronRightIcon, FolderTreeIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router";

import { errorMessage, type Schemas } from "@/api/client";
import { budgetsQuery, categoriesQuery, keys, putBudgets } from "@/api/queries";
import { AccountSelect } from "@/components/account-select";
import { EmptyState } from "@/components/empty-state";
import { ErrorState } from "@/components/error-state";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useSelectedAccount } from "@/hooks/use-search-state";
import { formatMonth } from "@/lib/date";
import { addMonths, isMonth, monthOf } from "@/lib/month";
import { S } from "@/strings.zh";

import { BudgetTable } from "./budget-table";
import { type BudgetDraft, budgetChanges, draftAfterSave, groupLines } from "./model";

const T = S.budgets;

function BudgetsSkeleton() {
  return (
    <div role="status" aria-label={S.common.loading} className="space-y-5">
      <Skeleton className="h-40 rounded-xl" />
      <Skeleton className="h-[32rem] rounded-xl" />
    </div>
  );
}

/** The effective-from month and what choosing it means. */
function MonthCard({
  month,
  current,
  onChange,
}: {
  month: string;
  current: string;
  onChange: (month: string) => void;
}) {
  const label = formatMonth(month);
  return (
    <section
      aria-label={T.month.label}
      className="grid gap-4 rounded-xl border bg-card p-5 shadow-card md:grid-cols-[auto_1fr] md:gap-8"
    >
      <div>
        <div className="text-xs text-muted-foreground">{T.month.label}</div>
        <div className="mt-1.5 flex items-center gap-2">
          <Button
            variant="outline"
            size="icon-sm"
            onClick={() => onChange(addMonths(month, -1))}
            aria-label={T.month.previous}
          >
            <ChevronLeftIcon />
          </Button>
          <span className="num min-w-28 text-center text-base font-semibold" aria-live="polite">
            {label}
          </span>
          <Button
            variant="outline"
            size="icon-sm"
            onClick={() => onChange(addMonths(month, 1))}
            aria-label={T.month.next}
          >
            <ChevronRightIcon />
          </Button>
        </div>
        <div className="mt-2 h-6">
          {month === current ? (
            <span className="rounded-full bg-accent px-2 py-0.5 text-xs text-accent-foreground">
              {S.dashboard.month.current}
            </span>
          ) : (
            <Button variant="link" size="sm" className="h-6 px-0 text-xs" onClick={() => onChange(current)}>
              {T.month.current}
            </Button>
          )}
        </div>
      </div>
      <div className="flex gap-3 rounded-lg bg-accent/60 p-4 text-accent-foreground">
        <CalendarClockIcon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        <div className="space-y-1">
          <p className="font-medium">{T.explain.title(label)}</p>
          <p className="text-[13px] leading-5 opacity-90">{T.explain.body(label)}</p>
        </div>
      </div>
    </section>
  );
}

/** Pinned under the content while there are unsaved edits, and briefly after a save. */
function SaveBar({
  month,
  changes,
  invalid,
  pending,
  stale,
  error,
  saved,
  onDiscard,
  onSave,
}: {
  month: string;
  changes: number;
  invalid: number;
  pending: boolean;
  stale: boolean;
  error: string | null;
  saved: string | null;
  onDiscard: () => void;
  onSave: () => void;
}) {
  const dirty = changes > 0 || invalid > 0;
  return (
    <div
      className={cn(
        "sticky bottom-[calc(4.25rem+env(safe-area-inset-bottom))] z-20 rounded-xl border bg-popover/95 px-4 py-3 shadow-lg backdrop-blur lg:bottom-5",
        !dirty && !saved && "hidden",
      )}
    >
      {dirty ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0 text-sm">
            <span className="num font-medium">{T.bar.changes(changes)}</span>
            <span className="text-muted-foreground"> · {T.bar.from(formatMonth(month))}</span>
            {invalid > 0 ? <div className="text-xs text-over">{T.bar.invalid(invalid)}</div> : null}
            {error ? (
              <div role="alert" className="text-xs text-over">
                {error}
              </div>
            ) : null}
          </div>
          <div className="flex gap-2 max-sm:w-full">
            <Button variant="outline" onClick={onDiscard} disabled={pending} className="max-sm:flex-1">
              {T.bar.discard}
            </Button>
            <Button onClick={onSave} disabled={pending || stale || invalid > 0 || changes === 0} className="max-sm:flex-1">
              {pending ? T.bar.saving : T.bar.save}
            </Button>
          </div>
        </div>
      ) : null}
      <p role="status" className={cn("text-sm font-medium text-positive", (dirty || !saved) && "sr-only")}>
        {saved && !dirty ? T.bar.saved(formatMonth(saved)) : null}
      </p>
    </div>
  );
}

function BudgetsBody({
  account,
  month,
  current,
  onMonthChange,
}: {
  account: Schemas["AccountOut"];
  month: string;
  current: string;
  onMonthChange: (month: string) => void;
}) {
  const queryClient = useQueryClient();
  const tree = useQuery(categoriesQuery(account.id));
  // Keyed by account, so a kept-over result is always this account's (same currency).
  const budgets = useQuery({ ...budgetsQuery(account.id, month), placeholderData: keepPreviousData });
  // Edits survive a change of month: they are re-compared with the new month's amounts
  // and saved from whichever month is chosen when the user presses save.
  const [draft, setDraft] = useState<BudgetDraft>({});
  const [saved, setSaved] = useState<string | null>(null);

  useEffect(() => {
    if (!saved) return;
    const timer = setTimeout(() => setSaved(null), 4000);
    return () => clearTimeout(timer);
  }, [saved]);

  const save = useMutation({
    // `sent` is the draft the body was built from, to tell later typing apart from it.
    mutationFn: ({ body }: { body: Schemas["BudgetsPutIn"]; sent: BudgetDraft }) =>
      putBudgets(account.id, body),
    onSuccess: async (result, { body, sent }) => {
      queryClient.setQueryData(keys.budgetsAt(account.id, body.effective_from), result);
      setDraft((current) => draftAfterSave(current, sent));
      setSaved(body.effective_from);
      await Promise.all([
        // Other months may show the new amounts too (all months from this one on).
        queryClient.invalidateQueries({ queryKey: keys.budgets(account.id) }),
        // Also the Dashboard queries not on screen, so going back never shows stale figures.
        queryClient.invalidateQueries({ queryKey: keys.summaries(account.id), refetchType: "all" }),
      ]);
    },
  });

  if (tree.isLoadingError || budgets.isLoadingError) {
    return (
      <ErrorState
        title={S.errors.loadFailedTitle}
        error={tree.isLoadingError ? tree.error : budgets.error}
        onRetry={() => {
          void tree.refetch();
          void budgets.refetch();
        }}
      />
    );
  }

  const monthCard = <MonthCard month={month} current={current} onChange={onMonthChange} />;
  if (!tree.data || !budgets.data) {
    return (
      <div className="space-y-5">
        {monthCard}
        <Skeleton role="status" aria-label={S.common.loading} className="h-[32rem] rounded-xl" />
      </div>
    );
  }

  const lines = budgets.data.budgets;
  if (lines.length === 0) {
    return (
      <EmptyState
        icon={FolderTreeIcon}
        title={T.noCategories.title}
        body={T.noCategories.body}
        action={
          <Button asChild variant="outline" size="sm">
            <Link to={`/settings?tab=categories&account=${account.id}`}>{T.noCategories.action}</Link>
          </Button>
        }
      />
    );
  }

  const { items, invalid } = budgetChanges(lines, draft);

  return (
    <div className="space-y-5">
      {monthCard}
      <BudgetTable
        groups={groupLines(tree.data, lines)}
        draft={draft}
        currency={budgets.data.currency}
        onChange={(id, text) => {
          setSaved(null);
          // Resetting a running save would re-enable "save" and allow a second request.
          if (!save.isPending) save.reset();
          setDraft({ ...draft, [id]: text });
        }}
        className={cn("transition-opacity", budgets.isPlaceholderData && "opacity-60")}
      />
      <SaveBar
        month={month}
        changes={items.length}
        invalid={invalid.length}
        pending={save.isPending}
        // While another month loads, the changes are still counted against the previous
        // month's amounts, so saving now could leave a real change out.
        stale={budgets.isPlaceholderData}
        error={save.isError ? errorMessage(save.error) : null}
        saved={saved}
        onDiscard={() => {
          save.reset();
          setDraft({});
        }}
        onSave={() => save.mutate({ body: { effective_from: month, items }, sent: draft })}
      />
    </div>
  );
}

/**
 * Budgets of one account per level-2 category, set from a chosen month onward
 * (parent PRD R6). The account and month live in the URL, like on the Dashboard.
 */
export function BudgetsPage() {
  const [now] = useState(() => new Date());
  const { accounts, account, params, update } = useSelectedAccount();
  const current = monthOf(now);
  const requested = params.get("month");
  const month = isMonth(requested) ? requested : current;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-lg font-semibold tracking-tight">{T.title}</h1>
        {accounts.data && account ? (
          <AccountSelect accounts={accounts.data} value={account.id} onChange={(id) => update({ account: id })} />
        ) : null}
      </div>
      {accounts.isLoadingError ? (
        <ErrorState
          title={S.errors.loadFailedTitle}
          error={accounts.error}
          onRetry={() => void accounts.refetch()}
        />
      ) : account ? (
        <BudgetsBody
          key={account.id}
          account={account}
          month={month}
          current={current}
          onMonthChange={(next) => update({ month: next === current ? null : next })}
        />
      ) : (
        <BudgetsSkeleton />
      )}
    </div>
  );
}
