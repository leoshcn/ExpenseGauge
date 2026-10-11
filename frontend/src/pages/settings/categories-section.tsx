import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FolderTreeIcon, PencilIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { useState } from "react";

import { errorMessage, type Schemas } from "@/api/client";
import { categoriesQuery, createCategory, deleteCategory, keys, updateCategory } from "@/api/queries";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { EmptyState } from "@/components/empty-state";
import { ErrorState } from "@/components/error-state";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { S } from "@/strings.zh";

import { CategoryDialog } from "./category-dialog";
import { NameDialog } from "./name-dialog";
import { SectionCard } from "./section-card";

const T = S.settings.categories;

/** Level 1 has a name only; level 2 also has a description. */
type Target =
  | { id: number; name: string; level: 1 }
  | { id: number; name: string; level: 2; description: string | null };
type Dialog =
  | { kind: "add-parent" }
  | { kind: "add-child"; parent: Target }
  | { kind: "rename"; target: Target }
  | { kind: "edit-child"; target: Extract<Target, { level: 2 }> }
  | { kind: "delete"; target: Target };

function RowActions({
  target,
  onDialog,
}: {
  target: Target;
  onDialog: (dialog: Dialog) => void;
}) {
  return (
    <div className="flex shrink-0 items-center">
      {target.level === 1 ? (
        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground max-sm:size-8 max-sm:px-0"
          onClick={() => onDialog({ kind: "add-child", parent: target })}
          aria-label={T.addChild(target.name)}
          title={T.addChild(target.name)}
        >
          <PlusIcon />
          <span className="max-sm:hidden">{T.addChildShort}</span>
        </Button>
      ) : null}
      <Button
        variant="ghost"
        size="icon-sm"
        className="text-muted-foreground"
        onClick={() => onDialog(target.level === 1 ? { kind: "rename", target } : { kind: "edit-child", target })}
        aria-label={target.level === 1 ? T.rename(target.name) : T.edit(target.name)}
        title={target.level === 1 ? T.rename(target.name) : T.edit(target.name)}
      >
        <PencilIcon />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        className="text-muted-foreground hover:text-over"
        onClick={() => onDialog({ kind: "delete", target })}
        aria-label={T.delete(target.name)}
        title={T.delete(target.name)}
      >
        <Trash2Icon />
      </Button>
    </div>
  );
}

function DeleteCategoryDialog({
  target,
  accountId,
  onClose,
}: {
  target: Target;
  accountId: number;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const remove = useMutation({
    mutationFn: () => deleteCategory(target.id),
    onSuccess: async () => {
      // Its budgets go with it; every figure of the account may change.
      await queryClient.invalidateQueries({ queryKey: keys.account(accountId) });
      onClose();
    },
  });
  const copy = target.level === 1 ? T.deleteParent : T.deleteChild;
  return (
    <ConfirmDialog
      open
      onOpenChange={(open) => (open ? undefined : onClose())}
      title={copy.title(target.name)}
      description={copy.body}
      confirmLabel={T.confirmDelete}
      pendingLabel={T.deleting}
      pending={remove.isPending}
      // The backend refuses with its own reason (CATEGORY_IN_USE, CATEGORY_HAS_CHILDREN).
      error={remove.isError ? errorMessage(remove.error) : null}
      onConfirm={() => remove.mutate()}
    />
  );
}

/** One account's two-level category tree: add, rename or edit (level 2: name and description), delete (refused while in use). */
export function CategoriesSection({
  account,
  accountPicker,
}: {
  account: Schemas["AccountOut"];
  accountPicker: React.ReactNode;
}) {
  const queryClient = useQueryClient();
  const tree = useQuery(categoriesQuery(account.id));
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const close = () => setDialog(null);
  // Names appear in summaries, transactions and budgets too.
  const refresh = () => queryClient.invalidateQueries({ queryKey: keys.account(account.id) });

  let body: React.ReactNode;
  if (tree.isLoadingError) {
    body = (
      <ErrorState
        className="rounded-none border-0 border-t shadow-none"
        title={S.errors.loadFailedTitle}
        error={tree.error}
        onRetry={() => void tree.refetch()}
      />
    );
  } else if (!tree.data) {
    body = (
      <div role="status" aria-label={S.common.loading} className="space-y-2 border-t p-5">
        <Skeleton className="h-10" />
        <Skeleton className="h-10" />
        <Skeleton className="h-10" />
      </div>
    );
  } else if (tree.data.categories.length === 0) {
    body = (
      <div className="border-t p-4 sm:p-5">
        <EmptyState icon={FolderTreeIcon} title={T.empty.title} body={T.empty.body} className="py-10" />
      </div>
    );
  } else {
    body = (
      <ul>
        {tree.data.categories.map((parent) => {
          const parentTarget: Target = { id: parent.id, name: parent.name, level: 1 };
          return (
            <li key={parent.id} className="border-t">
              <div className="flex items-center gap-3 bg-muted/40 py-2 pr-2 pl-4 sm:pr-3 sm:pl-5">
                <div className="min-w-0 flex-1">
                  <span className="font-medium break-words">{parent.name}</span>
                  {parent.children.length > 0 ? (
                    <span className="num ml-2 text-xs text-muted-foreground">
                      {T.childCount(parent.children.length)}
                    </span>
                  ) : (
                    <span className="ml-2 text-xs text-warning-foreground">{T.noChildren}</span>
                  )}
                </div>
                <RowActions target={parentTarget} onDialog={setDialog} />
              </div>
              {parent.children.length > 0 ? (
                <ul>
                  {parent.children.map((child) => (
                    <li
                      key={child.id}
                      className="flex items-center gap-3 border-t py-1.5 pr-2 pl-9 sm:pr-3 sm:pl-12"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="break-words">{child.name}</p>
                        {child.description ? (
                          <p className="line-clamp-2 text-xs break-words whitespace-pre-line text-muted-foreground">
                            {child.description}
                          </p>
                        ) : null}
                      </div>
                      <RowActions
                        target={{ id: child.id, name: child.name, level: 2, description: child.description }}
                        onDialog={setDialog}
                      />
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          );
        })}
      </ul>
    );
  }

  return (
    <SectionCard
      title={T.title(account.name)}
      description={T.description}
      action={
        <div className="flex flex-wrap items-center gap-2">
          {accountPicker}
          <Button size="sm" onClick={() => setDialog({ kind: "add-parent" })} disabled={!tree.data}>
            <PlusIcon />
            {T.addParent}
          </Button>
        </div>
      }
    >
      {body}
      {dialog?.kind === "add-parent" ? (
        <NameDialog
          title={T.addParentTitle}
          label={T.name}
          placeholder={T.parentPlaceholder}
          submitLabel={T.create}
          pendingLabel={T.creating}
          onSubmit={async (name) => {
            await createCategory(account.id, { name });
            await refresh();
          }}
          onClose={close}
        />
      ) : null}
      {dialog?.kind === "add-child" ? (
        <CategoryDialog
          title={T.addChild(dialog.parent.name)}
          placeholder={T.childPlaceholder}
          submitLabel={T.create}
          pendingLabel={T.creating}
          onSubmit={async (fields) => {
            await createCategory(account.id, { ...fields, parent_id: dialog.parent.id });
            await refresh();
          }}
          onClose={close}
        />
      ) : null}
      {dialog?.kind === "rename" ? (
        <NameDialog
          title={T.renameTitle}
          label={T.name}
          initial={dialog.target.name}
          submitLabel={S.common.save}
          pendingLabel={S.common.saving}
          onSubmit={async (name) => {
            await updateCategory(dialog.target.id, { name });
            await refresh();
          }}
          onClose={close}
        />
      ) : null}
      {dialog?.kind === "edit-child" ? (
        <CategoryDialog
          title={T.editTitle}
          initial={{ name: dialog.target.name, description: dialog.target.description }}
          submitLabel={S.common.save}
          pendingLabel={S.common.saving}
          onSubmit={async (_fields, changes) => {
            await updateCategory(dialog.target.id, changes);
            await refresh();
          }}
          onClose={close}
        />
      ) : null}
      {dialog?.kind === "delete" ? (
        <DeleteCategoryDialog target={dialog.target} accountId={account.id} onClose={close} />
      ) : null}
    </SectionCard>
  );
}
