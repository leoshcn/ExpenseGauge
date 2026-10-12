import {
  type Announcements,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  type UniqueIdentifier,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { restrictToParentElement, restrictToVerticalAxis } from "@dnd-kit/modifiers";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { cn } from "cn";
import { FolderTreeIcon, GripVerticalIcon, PencilIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { useState } from "react";

import { errorMessage, type Schemas } from "@/api/client";
import {
  categoriesQuery,
  createCategory,
  deleteCategory,
  keys,
  reorderCategories,
  updateCategory,
} from "@/api/queries";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { EmptyState } from "@/components/empty-state";
import { ErrorState } from "@/components/error-state";
import { NameDialog } from "@/components/name-dialog";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { S } from "@/strings.zh";

import { CategoryDialog } from "./category-dialog";
import { categoryCreateBody, leadingEdgeCollision, movedOrder, reorderTree } from "./model";
import { SectionCard } from "./section-card";

const T = S.settings.categories;
const R = T.reorder;

// A row moves up and down only, and not past the ends of its own list.
const MODIFIERS = [restrictToVerticalAxis, restrictToParentElement];

/** Level 1 has a name only; level 2 also has a description and a budget account. */
type Target =
  | { id: number; name: string; level: 1 }
  | { id: number; name: string; level: 2; description: string | null; budgetAccountId: number };
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

/**
 * One list of siblings that can be reordered by dragging. Each list is its own drag
 * context, so a row can be dropped only among its siblings: a level-2 category cannot
 * reach another level-1 category. `onReorder` gets the new order, and only when it changed.
 */
function SortableGroup({
  items,
  onReorder,
  children,
}: {
  items: readonly { id: number; name: string }[];
  onReorder: (orderedIds: number[]) => void;
  children: React.ReactNode;
}) {
  const sensors = useSensors(
    // A few pixels of movement first, so a click or tap on the handle is not a drag.
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const ids = items.map((item) => item.id);
  const name = (id: UniqueIdentifier) => items.find((item) => item.id === id)?.name ?? "";
  // Dropped on a row, the dragged one takes that row's place.
  const place = (id: UniqueIdentifier) => ids.findIndex((other) => other === id) + 1;
  const announcements: Announcements = {
    onDragStart: ({ active }) => R.picked(name(active.id), place(active.id), ids.length),
    onDragOver: ({ active, over }) => (over ? R.moved(name(active.id), place(over.id), ids.length) : undefined),
    onDragEnd: ({ active, over }) =>
      over ? R.dropped(name(active.id), place(over.id), ids.length) : R.cancelled(name(active.id)),
    onDragCancel: ({ active }) => R.cancelled(name(active.id)),
  };
  return (
    <DndContext
      sensors={sensors}
      collisionDetection={leadingEdgeCollision}
      modifiers={MODIFIERS}
      accessibility={{ announcements, screenReaderInstructions: { draggable: R.instructions } }}
      onDragEnd={({ active, over }) => {
        const next = movedOrder(ids, active.id, over?.id);
        if (next) onReorder(next);
      }}
    >
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        {children}
      </SortableContext>
    </DndContext>
  );
}

/**
 * What makes a row sortable: `row` goes on the element that moves, `handle` on its
 * `DragHandle`. `single`: alone among its siblings. `locked`: an order is being saved.
 */
function useSortableRow(id: number, single: boolean, locked: boolean) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id,
    disabled: single || locked,
    attributes: { roleDescription: R.roleDescription },
  });
  return {
    row: { ref: setNodeRef, style: { transform: CSS.Translate.toString(transform), transition } },
    // The dragged row is drawn above the rows that make room for it.
    dragging: isDragging ? "relative z-10 bg-card shadow-card" : null,
    // With nothing to reorder it is a disabled button. While an order is being saved it
    // is only `aria-disabled` (set by useSortable), so the keyboard focus stays on it.
    handle: { ref: setActivatorNodeRef, ...attributes, ...listeners, disabled: single },
  };
}

/** The only part of a row that starts a drag, by pointer or (focused) by the space key. */
function DragHandle({ name, ...handle }: { name: string } & React.ComponentProps<"button">) {
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      className="-mr-2 cursor-grab touch-none text-muted-foreground aria-pressed:cursor-grabbing"
      {...handle}
      aria-label={R.handle(name)}
      title={R.handle(name)}
    >
      <GripVerticalIcon />
    </Button>
  );
}

/** A level-1 row; it is dragged as one block with the level-2 list passed as children. */
function ParentItem({
  parent,
  single,
  locked,
  onDialog,
  children,
}: {
  parent: Schemas["CategoryNode"];
  single: boolean;
  locked: boolean;
  onDialog: (dialog: Dialog) => void;
  children: React.ReactNode;
}) {
  const { row, dragging, handle } = useSortableRow(parent.id, single, locked);
  return (
    <li {...row} className={cn("border-t", dragging)}>
      <div className="flex items-center gap-3 bg-muted/40 py-2 pr-2 pl-1 sm:pr-3 sm:pl-2">
        <DragHandle name={parent.name} {...handle} />
        <div className="min-w-0 flex-1">
          <span className="font-medium break-words">{parent.name}</span>
          {parent.children.length > 0 ? (
            <span className="num ml-2 text-xs text-muted-foreground">{T.childCount(parent.children.length)}</span>
          ) : (
            <span className="ml-2 text-xs text-warning-foreground">{T.noChildren}</span>
          )}
        </div>
        <RowActions target={{ id: parent.id, name: parent.name, level: 1 }} onDialog={onDialog} />
      </div>
      {children}
    </li>
  );
}

function ChildItem({
  child,
  single,
  locked,
  onDialog,
}: {
  child: Schemas["CategoryLeaf"];
  single: boolean;
  locked: boolean;
  onDialog: (dialog: Dialog) => void;
}) {
  const { row, dragging, handle } = useSortableRow(child.id, single, locked);
  return (
    <li
      {...row}
      className={cn("flex items-center gap-3 border-t py-1.5 pr-2 pl-5 sm:pr-3 sm:pl-8", dragging)}
    >
      <DragHandle name={child.name} {...handle} />
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-x-2 break-words">
          {child.name}
          <span className="rounded-full border px-1.5 text-[11px] leading-[1.125rem] text-muted-foreground">
            <span className="sr-only">{T.budgetAccount}：</span>
            {child.budget_account.name}
          </span>
        </p>
        {child.description ? (
          <p className="line-clamp-2 text-xs break-words whitespace-pre-line text-muted-foreground">
            {child.description}
          </p>
        ) : null}
      </div>
      <RowActions
        target={{
          id: child.id,
          name: child.name,
          level: 2,
          description: child.description,
          budgetAccountId: child.budget_account.id,
        }}
        onDialog={onDialog}
      />
    </li>
  );
}

function DeleteCategoryDialog({ target, onClose }: { target: Target; onClose: () => void }) {
  const queryClient = useQueryClient();
  const remove = useMutation({
    mutationFn: () => deleteCategory(target.id),
    onSuccess: async () => {
      // Its budgets go with it; figures of every scope may change.
      await queryClient.invalidateQueries({ queryKey: keys.ledger });
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

/**
 * The global two-level category tree: add, rename or edit (level 2: name, budget account
 * and description), delete (refused while in use), and drag into the display order used
 * everywhere (level 1 among themselves, level 2 inside their level-1 category). Each
 * level-2 row shows its budget account.
 */
export function CategoriesSection({
  budgetAccounts,
}: {
  budgetAccounts: readonly Schemas["BudgetAccountOut"][];
}) {
  const queryClient = useQueryClient();
  const tree = useQuery(categoriesQuery());
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const close = () => setDialog(null);
  // Names and budget accounts appear in summaries, transactions and budgets too.
  const refresh = () => queryClient.invalidateQueries({ queryKey: keys.ledger });
  // Saved on drop. The list shows the new order at once and goes back if the save fails.
  const reorder = useMutation({
    mutationFn: (order: Schemas["CategoryOrderIn"]) => reorderCategories(order),
    onMutate: async (order) => {
      await queryClient.cancelQueries({ queryKey: keys.categories(null) });
      const previous = queryClient.getQueryData<Schemas["CategoryTree"]>(keys.categories(null));
      if (previous) {
        queryClient.setQueryData(
          keys.categories(null),
          reorderTree(previous, order.parent_id, order.ordered_ids),
        );
      }
      return { previous };
    },
    onError: (_error, _order, context) => {
      if (context?.previous) queryClient.setQueryData(keys.categories(null), context.previous);
    },
    // The dashboard, budgets and transactions list categories in the same order.
    onSettled: refresh,
  });

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
    const locked = reorder.isPending;
    const parents = tree.data.categories;
    body = (
      <SortableGroup
        items={parents}
        onReorder={(orderedIds) => reorder.mutate({ parent_id: null, ordered_ids: orderedIds })}
      >
        <ul>
          {parents.map((parent) => (
            <ParentItem key={parent.id} parent={parent} single={parents.length < 2} locked={locked} onDialog={setDialog}>
              {parent.children.length > 0 ? (
                // Its own drag context: a level-2 row has nowhere to land but this list.
                <SortableGroup
                  items={parent.children}
                  onReorder={(orderedIds) => reorder.mutate({ parent_id: parent.id, ordered_ids: orderedIds })}
                >
                  <ul>
                    {parent.children.map((child) => (
                      <ChildItem
                        key={child.id}
                        child={child}
                        single={parent.children.length < 2}
                        locked={locked}
                        onDialog={setDialog}
                      />
                    ))}
                  </ul>
                </SortableGroup>
              ) : null}
            </ParentItem>
          ))}
        </ul>
      </SortableGroup>
    );
  }

  return (
    <SectionCard
      title={T.title}
      description={T.description}
      action={
        <Button size="sm" onClick={() => setDialog({ kind: "add-parent" })} disabled={!tree.data}>
          <PlusIcon />
          {T.addParent}
        </Button>
      }
    >
      {reorder.isError ? (
        <p role="alert" className="border-t bg-over-soft px-4 py-2 text-sm text-over sm:px-5">
          {R.failed(errorMessage(reorder.error))}
        </p>
      ) : null}
      {body}
      {dialog?.kind === "add-parent" ? (
        <NameDialog
          title={T.addParentTitle}
          label={T.name}
          placeholder={T.parentPlaceholder}
          submitLabel={T.create}
          pendingLabel={T.creating}
          onSubmit={async (name) => {
            await createCategory({ name });
            await refresh();
          }}
          onClose={close}
        />
      ) : null}
      {dialog?.kind === "add-child" ? (
        <CategoryDialog
          title={T.addChild(dialog.parent.name)}
          budgetAccounts={budgetAccounts}
          placeholder={T.childPlaceholder}
          submitLabel={T.create}
          pendingLabel={T.creating}
          onSubmit={async (fields) => {
            await createCategory(categoryCreateBody(dialog.parent.id, fields));
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
          initial={{
            name: dialog.target.name,
            description: dialog.target.description,
            budgetAccountId: dialog.target.budgetAccountId,
          }}
          budgetAccounts={budgetAccounts}
          submitLabel={S.common.save}
          pendingLabel={S.common.saving}
          onSubmit={async (_fields, changes) => {
            await updateCategory(dialog.target.id, changes);
            await refresh();
          }}
          onClose={close}
        />
      ) : null}
      {dialog?.kind === "delete" ? <DeleteCategoryDialog target={dialog.target} onClose={close} /> : null}
    </SectionCard>
  );
}
