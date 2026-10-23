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
  tagsQuery,
  transactionPageQuery,
} from "@/api/queries";
import { EmptyState } from "@/components/empty-state";
import { ErrorState } from "@/components/error-state";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useHotkey } from "@/hooks/use-hotkey";
import { useSearchState } from "@/hooks/use-search-state";
import { DEFAULT_CURRENCY } from "@/lib/currency";
import { clearUndo } from "@/lib/undo";
import { S } from "@/strings.zh";

import { BulkBar, BulkDeleteDialog, RecategorizeDialog, RenameTagDialog } from "./bulk";
import { DeleteTransactionDialog, EditTransactionDialog } from "./edit-dialog";
import { Filters } from "./filters";
import { awaitsLists, FILTER_PARAMS, isFiltered, pageRange, readFilter } from "./model";
import { SearchFilters } from "./search-filters";
import { StatsLine, TransactionTable } from "./transaction-table";
import { runUndo } from "./undo";

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
 * Every transaction, newest first and grouped by day, filtered by month, payment channel,
 * budget account, category, text, amount, tags and days, or only the refunds not matched
 * to a payment. The category, the note and a refund's original payment can be changed, one
 * row at a time or (category) for the selected rows; rows can be deleted. Every change
 * offers an undo (toast, Ctrl/⌘+Z). Nothing can be created here (agents submit). Above
 * the list, the count, consumption count and net amount of the filter, on the Dashboard's
 * basis. Filters and page live in the URL
 * (`?month&channel&budget_account&category&refund=unmatched&q&min&max&from&to&tag&page`).
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
  const tags = useQuery(tagsQuery);
  const [editing, setEditing] = useState<Schemas["TransactionOut"] | null>(null);
  const [deleting, setDeleting] = useState<Schemas["TransactionOut"] | null>(null);
  const [batch, setBatch] = useState<"recategorize" | "delete" | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  // Selected rows by id, kept while paging; cleared when a filter changes.
  const [selected, setSelected] = useState<ReadonlyMap<number, Schemas["TransactionOut"]>>(new Map());
  const filterKey = JSON.stringify({ ...filter, page: null });
  const [selectionKey, setSelectionKey] = useState(filterKey);
  if (selectionKey !== filterKey) {
    setSelectionKey(filterKey);
    setSelected(new Map());
  }
  // The undo slot belongs to this page.
  useEffect(() => clearUndo, []);
  useHotkey({ key: "z", mod: true }, () => void runUndo());

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
            refundStatus={filter.refundStatus}
            now={now}
            onChange={(next) => update({ ...next, page: null })}
            className="w-full sm:w-auto"
          />
        </div>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <SearchFilters
            q={filter.q}
            amountMin={filter.amountMin}
            amountMax={filter.amountMax}
            tags={tags.data ?? []}
            selectedTags={filter.tags}
            dateFrom={filter.dateFrom}
            dateTo={filter.dateTo}
            now={now}
            onChange={(next) => update({ ...next, page: null })}
            onRenameTag={setRenaming}
            className="w-full sm:w-auto sm:flex-1"
          />
          {filtered ? (
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground"
              onClick={() => update(Object.fromEntries(FILTER_PARAMS.map((key) => [key, null])))}
            >
              {T.filters.clear}
            </Button>
          ) : null}
        </div>

        <StatsLine total={list.data.total} stats={list.data.stats} currency={currency} />

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
            selected={new Set(selected.keys())}
            onSelect={(rows, select) =>
              setSelected((current) => {
                const next = new Map(current);
                for (const row of rows) {
                  if (select) next.set(row.id, row);
                  else next.delete(row.id);
                }
                return next;
              })
            }
            onPage={(page) => update({ page: page > 1 ? page : null })}
            onEdit={setEditing}
            onDelete={setDeleting}
            onTag={(tag) => update({ tag: [tag], page: null })}
            className={cn("transition-opacity", list.isPlaceholderData && "opacity-60", selected.size > 0 && "mb-20")}
          />
        )}

        {selected.size > 0 ? (
          <BulkBar
            selected={[...selected.values()]}
            currency={currency}
            onRecategorize={() => setBatch("recategorize")}
            onDelete={() => setBatch("delete")}
            onClear={() => setSelected(new Map())}
          />
        ) : null}
        {batch === "recategorize" ? (
          <RecategorizeDialog
            selected={[...selected.values()]}
            tree={tree.data}
            onClose={() => setBatch(null)}
            onDone={() => {
              setBatch(null);
              setSelected(new Map());
            }}
          />
        ) : null}
        {batch === "delete" ? (
          <BulkDeleteDialog
            selected={[...selected.values()]}
            currency={currency}
            onClose={() => setBatch(null)}
            onDone={() => {
              setBatch(null);
              setSelected(new Map());
            }}
          />
        ) : null}
        {renaming !== null ? (
          <RenameTagDialog
            key={renaming}
            tag={renaming}
            onClose={() => setRenaming(null)}
            onDone={(to) => {
              setRenaming(null);
              if (filter.tags.includes(renaming)) {
                update({ tag: filter.tags.map((tag) => (tag === renaming ? to : tag)), page: null });
              }
            }}
          />
        ) : null}

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
