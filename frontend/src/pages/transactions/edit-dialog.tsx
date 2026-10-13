import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { cn } from "cn";
import { Trash2Icon } from "lucide-react";
import { useId, useState } from "react";

import { errorMessage, type Schemas } from "@/api/client";
import {
  deleteTransaction,
  keys,
  refundCandidatesQuery,
  refundsQuery,
  updateTransaction,
} from "@/api/queries";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { FormError } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useRestoreFocus } from "@/hooks/use-restore-focus";
import { formatDay } from "@/lib/date";
import { formatMoney, subtract } from "@/lib/money";
import { S } from "@/strings.zh";

import {
  budgetAccountOf,
  categoryEditable,
  isRefund,
  paymentRefunds,
  type RefundTarget,
  toRefundTarget,
  transactionChanges,
} from "./model";

const T = S.transactions;
const NOTE_MAX = 1000;

/**
 * Everything that shows a transaction's figures changes when one is edited, matched or
 * deleted (a match moves a refund into its payment's month and category).
 */
function useInvalidate() {
  const queryClient = useQueryClient();
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: keys.transactions }),
      // Also the Dashboard queries not on screen (every scope: a new category can move the
      // amount to another budget account), so going back never shows stale figures.
      queryClient.invalidateQueries({ queryKey: keys.summaries, refetchType: "all" }),
    ]);
}

function ReadOnlyFacts({
  transaction,
  currency,
  now,
}: {
  transaction: Schemas["TransactionOut"];
  currency: string;
  now: Date;
}) {
  const D = T.editDialog;
  const refund = isRefund(transaction.amount);
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 rounded-lg border bg-muted/40 px-4 py-3">
      <dt className="text-muted-foreground">{D.counterparty}</dt>
      <dd className="min-w-0 font-medium break-words">{transaction.counterparty}</dd>
      <dt className="text-muted-foreground">{D.amount}</dt>
      <dd className={cn("num font-medium", refund && "text-positive")}>
        {formatMoney(transaction.amount, currency)}
        {refund ? (
          <span className="ml-2 rounded-full bg-positive-soft px-1.5 text-[11px] leading-[1.125rem] font-medium text-positive">
            {T.refund}
          </span>
        ) : null}
      </dd>
      <dt className="text-muted-foreground">{D.date}</dt>
      <dd className="num">{formatDay(transaction.date, now)}</dd>
      <dt className="text-muted-foreground">{D.channel}</dt>
      <dd className="min-w-0 break-words">{transaction.channel_name}</dd>
      <dt className="text-muted-foreground">{D.descriptionLabel}</dt>
      <dd className={cn("min-w-0 break-words", !transaction.description && "text-muted-foreground")}>
        {transaction.description || D.noDescription}
      </dd>
    </dl>
  );
}

/** Payments the refund may be matched to, searchable; picking one closes the list. */
function CandidatePicker({
  refundId,
  currency,
  now,
  onPick,
  onBack,
}: {
  refundId: number;
  currency: string;
  now: Date;
  onPick: (payment: Schemas["TransactionOut"]) => void;
  onBack: () => void;
}) {
  const C = T.editDialog.candidates;
  const [search, setSearch] = useState("");
  const candidates = useQuery({
    ...refundCandidatesQuery(refundId, search.trim()),
    placeholderData: keepPreviousData,
  });
  const money = (value: string) => formatMoney(value, currency);

  let list: React.ReactNode;
  if (candidates.isError) {
    list = <FormError message={errorMessage(candidates.error)} />;
  } else if (!candidates.data) {
    list = (
      <p role="status" className="py-3 text-center text-xs text-muted-foreground">
        {C.loading}
      </p>
    );
  } else if (candidates.data.items.length === 0) {
    list = <p className="py-3 text-center text-xs text-muted-foreground">{C.empty}</p>;
  } else {
    const { items, total } = candidates.data;
    list = (
      <>
        <ul aria-label={C.title} className="max-h-60 divide-y overflow-y-auto rounded-md border">
          {items.map((payment) => (
            <li key={payment.id}>
              <button
                type="button"
                aria-label={C.choose(payment.counterparty, formatDay(payment.date, now))}
                onClick={() => onPick(payment)}
                className="w-full px-3 py-2 text-left outline-none hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:ring-[3px] focus-visible:ring-ring/50"
              >
                <div className="flex items-baseline justify-between gap-3">
                  <span className="min-w-0 truncate font-medium">{payment.counterparty}</span>
                  <span className="num shrink-0 font-medium">{money(payment.amount)}</span>
                </div>
                <div className="num mt-0.5 flex justify-between gap-3 text-xs text-muted-foreground">
                  <span className="min-w-0 truncate">
                    {formatDay(payment.date, now)} · {payment.channel_name} · {payment.category_name}
                  </span>
                  <span className="shrink-0">{C.refundable(money(subtract(payment.amount, payment.refunded)))}</span>
                </div>
              </button>
            </li>
          ))}
        </ul>
        {total > items.length ? (
          <p className="num text-xs text-muted-foreground">{C.more(items.length, total)}</p>
        ) : null}
      </>
    );
  }

  return (
    <div className="space-y-2 rounded-lg border bg-muted/40 p-3">
      <div>
        <div className="text-sm font-medium">{C.title}</div>
        <p className="text-xs text-muted-foreground">{C.description}</p>
      </div>
      <div className="flex gap-2">
        <Input
          type="search"
          aria-label={C.searchLabel}
          placeholder={C.search}
          value={search}
          maxLength={200}
          onChange={(event) => setSearch(event.target.value)}
          // Enter searches as the user types already; it must not submit the edit form.
          onKeyDown={(event) => (event.key === "Enter" ? event.preventDefault() : undefined)}
          className="bg-card"
        />
        <Button type="button" variant="ghost" onClick={onBack}>
          {C.back}
        </Button>
      </div>
      {list}
    </div>
  );
}

/**
 * A refund's original payment: none ("未匹配") with a way to choose one, or the chosen
 * payment with "更换" and "取消匹配". Nothing is saved until the dialog is saved.
 */
function RefundOfField({
  transaction,
  refundOf,
  onChange,
  currency,
  now,
}: {
  transaction: Schemas["TransactionOut"];
  refundOf: RefundTarget | null;
  onChange: (refundOf: RefundTarget | null) => void;
  currency: string;
  now: Date;
}) {
  const D = T.editDialog;
  const [picking, setPicking] = useState(false);
  const labelId = useId();

  return (
    <div role="group" aria-labelledby={labelId} className="space-y-1.5">
      <div id={labelId} className="text-sm leading-none font-medium">
        {D.refundOf}
      </div>
      {picking ? (
        <CandidatePicker
          refundId={transaction.id}
          currency={currency}
          now={now}
          onPick={(payment) => {
            onChange(toRefundTarget(payment));
            setPicking(false);
          }}
          onBack={() => setPicking(false)}
        />
      ) : refundOf ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2">
          <div className="min-w-0">
            <div className="num min-w-0 font-medium break-words">
              {D.refundOfSummary(
                formatDay(refundOf.date, now),
                refundOf.counterparty,
                formatMoney(refundOf.amount, currency),
              )}
            </div>
            <div className="text-xs text-muted-foreground">{D.refundOfCategory(refundOf.category_name)}</div>
          </div>
          <div className="flex gap-1">
            <Button type="button" variant="outline" size="sm" onClick={() => setPicking(true)}>
              {D.changeRefundOf}
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => onChange(null)}>
              {D.removeRefundOf}
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-dashed px-3 py-2">
          <span className="text-sm text-warning-foreground">{D.unmatched}</span>
          <Button type="button" variant="outline" size="sm" onClick={() => setPicking(true)}>
            {D.chooseRefundOf}
          </Button>
        </div>
      )}
      <p className="text-xs text-muted-foreground">{D.refundOfHint}</p>
    </div>
  );
}

/** A payment's matched refunds and what is left of it (read-only). */
function PaymentRefunds({
  transaction,
  currency,
  now,
}: {
  transaction: Schemas["TransactionOut"];
  currency: string;
  now: Date;
}) {
  const D = T.editDialog;
  const totals = paymentRefunds(transaction);
  const refunds = useQuery({ ...refundsQuery(transaction.id), enabled: totals !== null });
  if (totals === null) return null;
  const money = (value: string) => formatMoney(value, currency);

  return (
    <section aria-label={D.refunds} className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <div className="text-sm leading-none font-medium">{D.refunds}</div>
        <div className="num text-xs text-muted-foreground">
          {D.refundedTotal(money(totals.refunded))} · {totals.full ? T.fullyRefunded : D.net(money(totals.net))}
        </div>
      </div>
      {refunds.isError ? (
        <FormError message={errorMessage(refunds.error)} />
      ) : !refunds.data ? (
        <p role="status" className="text-xs text-muted-foreground">
          {D.refundsLoading}
        </p>
      ) : (
        <ul className="divide-y rounded-lg border">
          {refunds.data.map((refund) => (
            <li key={refund.id} className="flex items-baseline justify-between gap-3 px-3 py-2 text-sm">
              <span className="min-w-0 truncate">
                <span className="num text-muted-foreground">{formatDay(refund.date, now)} </span>
                {refund.counterparty}
              </span>
              <span className="num shrink-0 font-medium text-positive">{money(refund.amount)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * Changes a transaction's category (any level-2 category of the global tree; the budget
 * account follows from it) and note, and a refund's original payment (match, re-match or
 * remove). A matched refund's category follows its payment and cannot be chosen. A
 * payment lists its matched refunds. The channel cannot change. Mounted per transaction
 * (`key`), so the form starts from that transaction's values.
 */
export function EditTransactionDialog({
  transaction,
  tree,
  currency,
  now,
  onClose,
  onDelete,
}: {
  transaction: Schemas["TransactionOut"];
  tree: Schemas["CategoryTree"];
  currency: string;
  now: Date;
  onClose: () => void;
  onDelete: () => void;
}) {
  useRestoreFocus();
  const D = T.editDialog;
  const categoryId = useId();
  const noteId = useId();
  const refund = isRefund(transaction.amount);
  const [category, setCategory] = useState(transaction.category_id);
  const [note, setNote] = useState(transaction.note ?? "");
  const [refundOf, setRefundOf] = useState<RefundTarget | null>(transaction.refund_of);
  const invalidate = useInvalidate();
  const changes = transactionChanges(transaction, { categoryId: category, note, refundOf });
  const editable = categoryEditable(transaction, refundOf);
  const budgetAccount = budgetAccountOf(tree, category)?.name ?? transaction.budget_account_name;
  let categoryHint = D.categoryHint(budgetAccount);
  if (refundOf !== null) categoryHint = D.categoryFollows;
  else if (!editable) categoryHint = D.categoryRestores;

  const save = useMutation({
    mutationFn: (body: Schemas["TransactionUpdateIn"]) => updateTransaction(transaction.id, body),
    onSuccess: async () => {
      await invalidate();
      onClose();
    },
  });

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (changes) save.mutate(changes);
    else onClose();
  }

  return (
    <Dialog open onOpenChange={(open) => (!open && !save.isPending ? onClose() : undefined)}>
      <DialogContent closeLabel={S.common.close}>
        <DialogHeader>
          <DialogTitle>{D.title}</DialogTitle>
          <DialogDescription>{D.description}</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-4" noValidate>
          <ReadOnlyFacts transaction={transaction} currency={currency} now={now} />
          {refund ? (
            <RefundOfField
              transaction={transaction}
              refundOf={refundOf}
              onChange={setRefundOf}
              currency={currency}
              now={now}
            />
          ) : (
            <PaymentRefunds transaction={transaction} currency={currency} now={now} />
          )}
          <div className="space-y-1.5">
            <Label htmlFor={categoryId}>{D.category}</Label>
            <Select
              value={String(category)}
              onValueChange={(value) => setCategory(Number(value))}
              disabled={!editable}
            >
              <SelectTrigger id={categoryId} className="w-full" aria-describedby={`${categoryId}-hint`}>
                {editable ? (
                  <SelectValue />
                ) : (
                  // The payment's category, or (match being removed) the refund's own, which
                  // only the server knows: shown after saving.
                  <SelectValue>{refundOf ? refundOf.category_name : S.common.none}</SelectValue>
                )}
              </SelectTrigger>
              <SelectContent position="popper" className="max-h-72">
                {tree.categories
                  .filter((parent) => parent.children.length > 0)
                  .map((parent) => (
                    <SelectGroup key={parent.id}>
                      <SelectLabel>{parent.name}</SelectLabel>
                      {parent.children.map((child) => (
                        <SelectItem key={child.id} value={String(child.id)} className="pl-4">
                          {child.name}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  ))}
              </SelectContent>
            </Select>
            <p id={`${categoryId}-hint`} className="text-xs text-muted-foreground">
              {categoryHint}
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={noteId}>{D.note}</Label>
            <Textarea
              id={noteId}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder={D.notePlaceholder}
              maxLength={NOTE_MAX}
              rows={2}
            />
          </div>
          <FormError message={save.isError ? errorMessage(save.error) : null} />
          <DialogFooter className="sm:justify-between">
            <Button
              type="button"
              variant="ghost"
              className="text-over hover:bg-over-soft hover:text-over"
              onClick={onDelete}
              disabled={save.isPending}
            >
              <Trash2Icon />
              {D.delete}
            </Button>
            <div className="flex flex-col-reverse gap-2 sm:flex-row">
              <Button type="button" variant="outline" onClick={onClose} disabled={save.isPending}>
                {S.common.cancel}
              </Button>
              <Button type="submit" disabled={save.isPending || changes === null}>
                {save.isPending ? S.common.saving : S.common.save}
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Confirms and deletes one transaction. */
export function DeleteTransactionDialog({
  transaction,
  currency,
  now,
  onClose,
}: {
  transaction: Schemas["TransactionOut"];
  currency: string;
  now: Date;
  onClose: () => void;
}) {
  const D = T.deleteDialog;
  const invalidate = useInvalidate();
  const remove = useMutation({
    mutationFn: () => deleteTransaction(transaction.id),
    onSuccess: async () => {
      await invalidate();
      onClose();
    },
  });
  return (
    <ConfirmDialog
      open
      onOpenChange={(open) => (open ? undefined : onClose())}
      title={D.title}
      description={D.body(
        formatDay(transaction.date, now),
        transaction.counterparty,
        formatMoney(transaction.amount, currency),
      )}
      confirmLabel={D.confirm}
      pendingLabel={D.deleting}
      pending={remove.isPending}
      error={remove.isError ? errorMessage(remove.error) : null}
      onConfirm={() => remove.mutate()}
    />
  );
}
