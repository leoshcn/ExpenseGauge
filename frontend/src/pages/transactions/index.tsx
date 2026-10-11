import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { cn } from "cn";
import { InboxIcon, SearchXIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router";

import type { Schemas } from "@/api/client";
import {
  budgetAccountsQuery,
  categoriesQuery,
  channelsQuery,
  settingsQuery,
  transactionPageQuery,
} from "@/api/queries";
import { EmptyState } from "@/components/empty-state";
import { ErrorState } from "@/components/error-state";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useSearchState } from "@/hooks/use-search-state";
import { DEFAULT_CURRENCY } from "@/lib/currency";
import { S } from "@/strings.zh";

import { DeleteTransactionDialog, EditTransactionDialog } from "./edit-dialog";
import { Filters } from "./filters";
import { awaitsLists, isFiltered, pageRange, readFilter } from "./model";
import { TransactionTable } from "./transaction-table";

const T = S.transactions;

function ListSkeleton() {
  return (
    <div role="status" aria-label={S.common.loading} className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:flex">
        <Skeleton className="h-14 sm:w-36" />
        <Skeleton className="h-14 sm:w-40" />
        <Skeleton className="h-14 sm:w-36" />
        <Skeleton className="h-14 sm:w-56" />
      </div>
      <Skeleton className="h-[32rem] rounded-xl" />
    </div>
  );
}

/**
 * Every transaction, newest first, filtered by month, payment channel, budget account
 * and category. Only the category and the note can be changed; nothing can be created
 * here (agents submit). Filters and page live in the URL
 * (`?month&channel&budget_account&category&page`).
 */
export function TransactionsPage() {
  const [now] = useState(() => new Date());
  const { params, update } = useSearchState();
  const settings = useQuery(settingsQuery);
  const tree = useQuery(categoriesQuery());
  const channels = useQuery(channelsQuery);
  const budgetAccounts = useQuery(budgetAccountsQuery);
  const lists = { tree: tree.data, channels: channels.data, budgetAccounts: budgetAccounts.data };
  const filter = readFilter(params, lists);
  const list = useQuery({
    ...transactionPageQuery(filter),
    placeholderData: keepPreviousData,
    // An id from the URL is checked against its list first, so one that does not exist
    // (a stale link) never reaches the API and fails the page.
    enabled: !awaitsLists(params, lists),
  });
  const [editing, setEditing] = useState<Schemas["TransactionOut"] | null>(null);
  const [deleting, setDeleting] = useState<Schemas["TransactionOut"] | null>(null);

  // Deleting the last row of the last page leaves the page past the end: step back.
  const pages = list.data ? pageRange(list.data.page, list.data.page_size, list.data.total).pages : 1;
  const pastEnd = list.data !== undefined && !list.isPlaceholderData && filter.page > pages;
  useEffect(() => {
    if (pastEnd) update({ page: pages > 1 ? pages : null });
  }, [pastEnd, pages, update]);

  const failed = [settings, tree, channels, budgetAccounts, list].find((query) => query.isLoadingError);
  let body: React.ReactNode;
  if (failed) {
    body = (
      <ErrorState
        title={S.errors.loadFailedTitle}
        error={failed.error}
        onRetry={() => {
          for (const query of [settings, tree, channels, budgetAccounts, list]) void query.refetch();
        }}
      />
    );
  } else if (!settings.data || !tree.data || !channels.data || !budgetAccounts.data || !list.data) {
    body = <ListSkeleton />;
  } else {
    // Set before the app is reachable (onboarding step 1); the fallback only satisfies the type.
    const currency = settings.data.currency ?? DEFAULT_CURRENCY;
    const filtered = isFiltered(filter);
    body = (
      <div className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <Filters
            tree={tree.data}
            channels={channels.data}
            budgetAccounts={budgetAccounts.data}
            month={filter.month}
            channelId={filter.channelId}
            budgetAccountId={filter.budgetAccountId}
            categoryId={filter.categoryId}
            now={now}
            onChange={(next) => update({ ...next, page: null })}
            className="w-full sm:w-auto"
          />
          {filtered ? (
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground"
              onClick={() => update({ month: null, channel: null, budget_account: null, category: null, page: null })}
            >
              {T.filters.clear}
            </Button>
          ) : null}
        </div>

        {list.data.total === 0 ? (
          filtered ? (
            <EmptyState icon={SearchXIcon} title={T.noMatch.title} body={T.noMatch.body} />
          ) : (
            <EmptyState
              icon={InboxIcon}
              title={T.empty.title}
              body={T.empty.body}
              action={
                <Button asChild variant="outline" size="sm">
                  <Link to="/settings?tab=agent">{T.empty.action}</Link>
                </Button>
              }
            />
          )
        ) : (
          <TransactionTable
            page={list.data}
            currency={currency}
            now={now}
            onPage={(page) => update({ page: page > 1 ? page : null })}
            onEdit={setEditing}
            onDelete={setDeleting}
            className={cn("transition-opacity", list.isPlaceholderData && "opacity-60")}
          />
        )}

        {editing ? (
          <EditTransactionDialog
            key={editing.id}
            transaction={editing}
            tree={tree.data}
            currency={currency}
            now={now}
            onClose={() => setEditing(null)}
            onDelete={() => {
              setDeleting(editing);
              setEditing(null);
            }}
          />
        ) : null}
        {deleting ? (
          <DeleteTransactionDialog
            key={deleting.id}
            transaction={deleting}
            currency={currency}
            now={now}
            onClose={() => setDeleting(null)}
          />
        ) : null}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <h1 className="text-lg font-semibold tracking-tight">{T.title}</h1>
      {body}
    </div>
  );
}
