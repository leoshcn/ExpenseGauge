import { useMutation } from "@tanstack/react-query";
import { Trash2Icon, XIcon } from "lucide-react";
import { useId, useState } from "react";

import { errorMessage, type Schemas } from "@/api/client";
import { bulkDeleteTransactions, bulkUpdateTransactions, renameTag, restoreTransactions } from "@/api/queries";
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
import { useRestoreFocus } from "@/hooks/use-restore-focus";
import { formatMoney } from "@/lib/money";
import { isValidTag } from "@/lib/tags";
import { S } from "@/strings.zh";

import { findCategory, recategorizable, sumAmounts } from "./model";
import { useInvalidateLedger, useOfferUndo } from "./undo";

const T = S.transactions;
const B = T.bulk;

/** Fixed above the page bottom while rows are selected: count, sum and the batch actions. */
export function BulkBar({
  selected,
  currency,
  onRecategorize,
  onDelete,
  onClear,
}: {
  selected: readonly Schemas["TransactionOut"][];
  currency: string;
  onRecategorize: () => void;
  onDelete: () => void;
  onClear: () => void;
}) {
  return (
    <div
      role="region"
      aria-label={B.label}
      className="fixed inset-x-0 bottom-[calc(3.5rem+env(safe-area-inset-bottom))] z-20 px-4 pb-3 lg:bottom-0 lg:pl-60"
    >
      <div className="mx-auto flex max-w-[1136px] flex-wrap items-center justify-between gap-2 rounded-xl border bg-popover px-4 py-2.5 shadow-lg">
        <span className="num amount text-sm font-medium" aria-live="polite">
          {B.selected(selected.length, formatMoney(sumAmounts(selected), currency))}
        </span>
        <div className="flex items-center gap-2">
          <Button size="sm" onClick={onRecategorize}>
            {B.recategorize}
          </Button>
          <Button size="sm" variant="outline" className="text-over hover:bg-over-soft hover:text-over" onClick={onDelete}>
            <Trash2Icon />
            {B.delete}
          </Button>
          <Button size="icon-sm" variant="ghost" aria-label={B.clear} title={B.clear} onClick={onClear}>
            <XIcon />
          </Button>
        </div>
      </div>
    </div>
  );
}

/** Moves the selected rows to one level-2 category; matched refunds are skipped. */
export function RecategorizeDialog({
  selected,
  tree,
  onClose,
  onDone,
}: {
  selected: readonly Schemas["TransactionOut"][];
  tree: Schemas["CategoryTree"];
  onClose: () => void;
  onDone: () => void;
}) {
  useRestoreFocus();
  const id = useId();
  const [categoryId, setCategoryId] = useState<number | null>(null);
  const { changed, skipped } = recategorizable(selected);
  const invalidate = useInvalidateLedger();
  const offerUndo = useOfferUndo();
  const save = useMutation({
    mutationFn: (category: number) =>
      bulkUpdateTransactions(changed.map((row) => ({ transaction_id: row.id, category_id: category }))),
    onSuccess: async (_, category) => {
      await invalidate();
      const before = changed.map((row) => ({ transaction_id: row.id, category_id: row.category_id }));
      const found = findCategory(tree, category);
      offerUndo(T.undo.recategorized(changed.length, found?.child?.name ?? ""), () => bulkUpdateTransactions(before));
      onDone();
    },
  });

  return (
    <Dialog open onOpenChange={(open) => (!open && !save.isPending ? onClose() : undefined)}>
      <DialogContent closeLabel={S.common.close}>
        <DialogHeader>
          <DialogTitle>{B.recategorizeTitle(changed.length)}</DialogTitle>
          <DialogDescription>{changed.length === 0 ? B.nothingToChange : B.recategorizeBody}</DialogDescription>
        </DialogHeader>
        {skipped.length > 0 && changed.length > 0 ? (
          <p className="rounded-md bg-warning-soft px-3 py-2 text-xs text-warning-foreground">{B.skipped(skipped.length)}</p>
        ) : null}
        {changed.length > 0 ? (
          <div className="space-y-1.5">
            <Label htmlFor={id}>{B.category}</Label>
            <Select value={categoryId === null ? "" : String(categoryId)} onValueChange={(value) => setCategoryId(Number(value))}>
              <SelectTrigger id={id} className="w-full">
                <SelectValue placeholder={B.chooseCategory} />
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
          </div>
        ) : null}
        <FormError message={save.isError ? errorMessage(save.error) : null} />
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={save.isPending}>
            {S.common.cancel}
          </Button>
          {changed.length > 0 ? (
            <Button
              disabled={categoryId === null || save.isPending}
              onClick={() => (categoryId === null ? undefined : save.mutate(categoryId))}
            >
              {save.isPending ? B.applying : B.apply}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Confirms and deletes the selected rows; the toast can bring them back. */
export function BulkDeleteDialog({
  selected,
  currency,
  onClose,
  onDone,
}: {
  selected: readonly Schemas["TransactionOut"][];
  currency: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const invalidate = useInvalidateLedger();
  const offerUndo = useOfferUndo();
  const ids = selected.map((row) => row.id);
  const remove = useMutation({
    mutationFn: () => bulkDeleteTransactions(ids),
    onSuccess: async () => {
      await invalidate();
      offerUndo(T.undo.deleted(ids.length), () => restoreTransactions(ids));
      onDone();
    },
  });
  return (
    <ConfirmDialog
      open
      onOpenChange={(open) => (open ? undefined : onClose())}
      title={B.deleteTitle(ids.length)}
      description={B.deleteBody(formatMoney(sumAmounts(selected), currency))}
      confirmLabel={B.deleteConfirm}
      pendingLabel={B.deleting}
      pending={remove.isPending}
      error={remove.isError ? errorMessage(remove.error) : null}
      onConfirm={() => remove.mutate()}
    />
  );
}

/** Renames a tag in every note; the toast puts each note back as it was. */
export function RenameTagDialog({ tag, onClose, onDone }: { tag: string; onClose: () => void; onDone: (to: string) => void }) {
  useRestoreFocus();
  const D = T.renameDialog;
  const id = useId();
  const [name, setName] = useState(tag);
  const trimmed = name.trim().replace(/^#/, "");
  const valid = isValidTag(trimmed);
  const invalidate = useInvalidateLedger();
  const offerUndo = useOfferUndo();
  const save = useMutation({
    mutationFn: () => renameTag({ from_tag: tag, to_tag: trimmed }),
    onSuccess: async (result) => {
      await invalidate();
      offerUndo(T.undo.renamed(tag, trimmed, result.changed.length), () =>
        bulkUpdateTransactions(
          result.changed.map((change) => ({ transaction_id: change.transaction_id, note: change.note_before })),
        ),
      );
      onDone(trimmed);
    },
  });

  return (
    <Dialog open onOpenChange={(open) => (!open && !save.isPending ? onClose() : undefined)}>
      <DialogContent closeLabel={S.common.close}>
        <DialogHeader>
          <DialogTitle>{D.title(tag)}</DialogTitle>
          <DialogDescription>{D.body}</DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            if (valid && trimmed !== tag) save.mutate();
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor={id}>{D.label}</Label>
            <Input
              id={id}
              value={name}
              onChange={(event) => setName(event.target.value)}
              aria-invalid={valid ? undefined : true}
              aria-describedby={valid ? undefined : `${id}-error`}
              autoFocus
            />
            {valid ? null : (
              <p id={`${id}-error`} className="text-xs text-over">
                {D.invalid}
              </p>
            )}
          </div>
          <FormError message={save.isError ? errorMessage(save.error) : null} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={save.isPending}>
              {S.common.cancel}
            </Button>
            <Button type="submit" disabled={!valid || trimmed === tag || save.isPending}>
              {save.isPending ? D.saving : D.save}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
