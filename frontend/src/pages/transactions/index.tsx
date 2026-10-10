import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { cn } from "cn";
import { InboxIcon, SearchXIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router";

import type { Schemas } from "@/api/client";
import { categoriesQuery, transactionPageQuery } from "@/api/queries";
import { AccountSelect } from "@/components/account-select";
import { EmptyState } from "@/components/empty-state";
import { ErrorState } from "@/components/error-state";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useSelectedAccount } from "@/hooks/use-search-state";
import { S } from "@/strings.zh";

import { DeleteTransactionDialog, EditTransactionDialog } from "./edit-dialog";
import { Filters } from "./filters";
import { pageRange, readFilter } from "./model";
import { TransactionTable } from "./transaction-table";

const T = S.transactions;

function ListSkeleton() {
  return (
    <div role="status" aria-label={S.common.loading} className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:flex">
        <Skeleton className="h-14 sm:w-40" />
        <Skeleton className="h-14 sm:w-56" />
      </div>
      <Skeleton className="h-[32rem] rounded-xl" />
    </div>
  );
}

function TransactionsBody({
  account,
  params,
  update,
  now,
}: {
  account: Schemas["AccountOut"];
  params: URLSearchParams;
  update: (next: Record<string, string | number | null>) => void;
  now: Date;
}) {
  const tree = useQuery(categoriesQuery(account.id));
  const filter = readFilter(params, tree.data);
  const list = useQuery({
    ...transactionPageQuery(account.id, filter),
    // The body is keyed by account, so the previous page is always this account's.
    placeholderData: keepPreviousData,
    // A category from the URL is checked against the tree first, so one that is not in
    // this account (a stale link) never reaches the API and fails the page.
    enabled: tree.data !== undefined || !params.has("category"),
  });
  const [editing, setEditing] = useState<Schemas["TransactionOut"] | null>(null);
  const [deleting, setDeleting] = useState<Schemas["TransactionOut"] | null>(null);

  // Deleting the last row of the last page leaves the page past the end: step back.
  const pages = list.data ? pageRange(list.data.page, list.data.page_size, list.data.total).pages : 1;
  const pastEnd = list.data !== undefined && !list.isPlaceholderData && filter.page > pages;
  useEffect(() => {
    if (pastEnd) update({ page: pages > 1 ? pages : null });
  }, [pastEnd, pages, update]);

  if (tree.isLoadingError || list.isLoadingError) {
    return (
      <ErrorState
        title={S.errors.loadFailedTitle}
        error={tree.isLoadingError ? tree.error : list.error}
        onRetry={() => {
          void tree.refetch();
          void list.refetch();
        }}
      />
    );
  }
  if (!tree.data || !list.data) return <ListSkeleton />;

  const filtered = filter.month !== null || filter.categoryId !== null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <Filters
          tree={tree.data}
          month={filter.month}
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
            onClick={() => update({ month: null, category: null, page: null })}
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
          currency={account.currency}
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
          currency={account.currency}
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
          currency={account.currency}
          now={now}
          onClose={() => setDeleting(null)}
        />
      ) : null}
    </div>
  );
}

/**
 * Transactions of one account, filtered by month and category, newest first. Only the
 * category and the note can be changed; nothing can be created here (agents submit).
 * Account, filters and page live in the URL.
 */
export function TransactionsPage() {
  const [now] = useState(() => new Date());
  const { accounts, account, params, update } = useSelectedAccount();

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-lg font-semibold tracking-tight">{T.title}</h1>
        {accounts.data && account ? (
          <AccountSelect
            accounts={accounts.data}
            value={account.id}
            // Categories differ per account, so the category filter and page start over.
            onChange={(id) => update({ account: id, category: null, page: null })}
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
        <TransactionsBody key={account.id} account={account} params={params} update={update} now={now} />
      ) : (
        <ListSkeleton />
      )}
    </div>
  );
}
