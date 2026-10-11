import { useMutation, useQueryClient } from "@tanstack/react-query";
import { cn } from "cn";
import { Trash2Icon } from "lucide-react";
import { useId, useState } from "react";

import { errorMessage, type Schemas } from "@/api/client";
import { deleteTransaction, keys, updateTransaction } from "@/api/queries";
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
import { formatMoney } from "@/lib/money";
import { S } from "@/strings.zh";

import { budgetAccountOf, isRefund, transactionChanges } from "./model";

const T = S.transactions;
const NOTE_MAX = 1000;

/** Everything that shows a transaction's figures changes when one is edited or deleted. */
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

/**
 * Changes a transaction's category (any level-2 category of the global tree; the budget
 * account follows from it) and note. The channel cannot change. Mounted per transaction
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
  const [category, setCategory] = useState(transaction.category_id);
  const [note, setNote] = useState(transaction.note ?? "");
  const invalidate = useInvalidate();
  const changes = transactionChanges(transaction, { categoryId: category, note });
  const budgetAccount = budgetAccountOf(tree, category)?.name ?? transaction.budget_account_name;

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
          <div className="space-y-1.5">
            <Label htmlFor={categoryId}>{D.category}</Label>
            <Select value={String(category)} onValueChange={(value) => setCategory(Number(value))}>
              <SelectTrigger id={categoryId} className="w-full" aria-describedby={`${categoryId}-hint`}>
                <SelectValue />
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
              {D.categoryHint(budgetAccount)}
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
