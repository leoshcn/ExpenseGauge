import { cn } from "cn";
import { ChevronLeftIcon, ChevronRightIcon, PencilIcon, StickyNoteIcon, Trash2Icon } from "lucide-react";

import type { Schemas } from "@/api/client";
import { Button } from "@/components/ui/button";
import { formatDay } from "@/lib/date";
import { formatMoney } from "@/lib/money";
import { S } from "@/strings.zh";

import { isRefund, pageRange } from "./model";

const T = S.transactions;

function Chip({ tone, children, title }: { tone: "refund" | "muted"; children: React.ReactNode; title?: string }) {
  return (
    <span
      title={title}
      className={cn(
        "shrink-0 rounded-full px-1.5 text-[11px] leading-[1.125rem] font-medium",
        tone === "refund" && "bg-positive-soft text-positive",
        tone === "muted" && "border font-normal text-muted-foreground",
      )}
    >
      {children}
    </span>
  );
}

function Row({
  transaction,
  currency,
  now,
  onEdit,
  onDelete,
}: {
  transaction: Schemas["TransactionOut"];
  currency: string;
  now: Date;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const refund = isRefund(transaction.amount);
  const day = formatDay(transaction.date, now);
  const cell = "py-3 align-top";
  const category = (
    <>
      <span className="text-muted-foreground">{transaction.parent_category_name} / </span>
      {transaction.category_name}
    </>
  );

  return (
    <tr className="cursor-pointer border-t transition-colors hover:bg-muted/50" onClick={onEdit}>
      <td className={cn("num hidden pr-3 pl-5 whitespace-nowrap text-muted-foreground md:table-cell", cell)}>
        {day}
      </td>
      <th scope="row" className={cn("w-full max-w-0 px-4 text-left font-normal md:w-[30%] md:px-3", cell)}>
        <div className="flex min-w-0 items-center gap-2">
          <span className="min-w-0 truncate font-medium" title={transaction.counterparty}>
            {transaction.counterparty}
          </span>
          {refund ? <Chip tone="refund">{T.refund}</Chip> : null}
          {transaction.confirmed_duplicate ? (
            <Chip tone="muted" title={T.confirmedDuplicateHint}>
              {T.confirmedDuplicate}
            </Chip>
          ) : null}
        </div>
        {transaction.description ? (
          <div className="truncate text-xs text-muted-foreground" title={transaction.description}>
            {transaction.description}
          </div>
        ) : null}
        {/* Below `md` the date, category, channel and note fold in under the counterparty. */}
        <div className="mt-1 truncate text-xs md:hidden">
          <span className="num text-muted-foreground">{day} · </span>
          {category}
          <span className="text-muted-foreground"> · {transaction.channel_name}</span>
        </div>
        {transaction.note ? (
          <div className="mt-1 flex min-w-0 items-center gap-1 text-xs text-muted-foreground lg:hidden">
            <StickyNoteIcon className="size-3 shrink-0" aria-hidden="true" />
            <span className="sr-only">{T.noteLabel}</span>
            <span className="truncate">{transaction.note}</span>
          </div>
        ) : null}
      </th>
      <td className={cn("hidden max-w-0 truncate px-3 md:table-cell md:w-[22%]", cell)}>{category}</td>
      <td className={cn("hidden max-w-0 truncate px-3 md:table-cell md:w-[16%]", cell)} title={transaction.channel_name}>
        {transaction.channel_name}
      </td>
      <td
        className={cn("hidden max-w-0 truncate px-3 text-muted-foreground lg:table-cell lg:w-[16%]", cell)}
        title={transaction.note ?? undefined}
      >
        {transaction.note ?? S.common.none}
      </td>
      <td
        className={cn(
          "num px-1 text-right font-medium whitespace-nowrap md:px-3",
          cell,
          refund && "text-positive",
        )}
      >
        {formatMoney(transaction.amount, currency)}
      </td>
      <td className={cn("py-2 pr-2 pl-1 text-right whitespace-nowrap sm:pr-3", "align-top")}>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={T.edit(transaction.counterparty)}
          title={T.edit(transaction.counterparty)}
          className="text-muted-foreground"
          onClick={(event) => {
            event.stopPropagation();
            onEdit();
          }}
        >
          <PencilIcon />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={T.delete(transaction.counterparty)}
          title={T.delete(transaction.counterparty)}
          className="hidden text-muted-foreground hover:text-over md:inline-flex"
          onClick={(event) => {
            event.stopPropagation();
            onDelete();
          }}
        >
          <Trash2Icon />
        </Button>
      </td>
    </tr>
  );
}

/** One page of transactions, newest first, with paging below. */
export function TransactionTable({
  page,
  currency,
  now,
  onPage,
  onEdit,
  onDelete,
  className,
}: {
  page: Schemas["TransactionPage"];
  currency: string;
  now: Date;
  onPage: (page: number) => void;
  onEdit: (transaction: Schemas["TransactionOut"]) => void;
  onDelete: (transaction: Schemas["TransactionOut"]) => void;
  className?: string;
}) {
  const { from, to, pages } = pageRange(page.page, page.page_size, page.total);
  const heading = "px-3 py-2.5 text-xs font-medium text-muted-foreground";

  return (
    <section className={cn("overflow-hidden rounded-xl border bg-card shadow-card", className)}>
      <table className="w-full border-collapse">
        <thead>
          <tr className="bg-muted/40">
            <th scope="col" className={cn(heading, "hidden pl-5 text-left md:table-cell")}>
              {T.columns.date}
            </th>
            <th scope="col" className={cn(heading, "px-4 text-left md:px-3")}>
              {T.columns.counterparty}
            </th>
            <th scope="col" className={cn(heading, "hidden text-left md:table-cell")}>
              {T.columns.category}
            </th>
            <th scope="col" className={cn(heading, "hidden text-left md:table-cell")}>
              {T.columns.channel}
            </th>
            <th scope="col" className={cn(heading, "hidden text-left lg:table-cell")}>
              {T.columns.note}
            </th>
            <th scope="col" className={cn(heading, "px-1 text-right md:px-3")}>
              {T.columns.amount}
            </th>
            <th scope="col" className={cn(heading, "pr-2 sm:pr-3")}>
              <span className="sr-only">{T.columns.actions}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {page.items.map((transaction) => (
            <Row
              key={transaction.id}
              transaction={transaction}
              currency={currency}
              now={now}
              onEdit={() => onEdit(transaction)}
              onDelete={() => onDelete(transaction)}
            />
          ))}
        </tbody>
      </table>
      <nav
        aria-label={T.pagination.label}
        className="flex items-center justify-between gap-3 border-t px-4 py-3 sm:px-5"
      >
        <span className="num text-xs text-muted-foreground">{T.pagination.range(from, to, page.total)}</span>
        {pages > 1 ? (
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="icon-sm"
              disabled={page.page <= 1}
              onClick={() => onPage(page.page - 1)}
              aria-label={T.pagination.previous}
            >
              <ChevronLeftIcon />
            </Button>
            <span className="num min-w-12 text-center text-xs text-muted-foreground" aria-live="polite">
              {T.pagination.page(page.page, pages)}
            </span>
            <Button
              variant="outline"
              size="icon-sm"
              disabled={page.page >= pages}
              onClick={() => onPage(page.page + 1)}
              aria-label={T.pagination.next}
            >
              <ChevronRightIcon />
            </Button>
          </div>
        ) : null}
      </nav>
    </section>
  );
}
