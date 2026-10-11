import { useMutation } from "@tanstack/react-query";
import { useId, useState } from "react";

import { errorMessage } from "@/api/client";
import { FormError, FormField } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useRestoreFocus } from "@/hooks/use-restore-focus";
import { S } from "@/strings.zh";

import {
  CATEGORY_DESCRIPTION_MAX,
  categoryChanges,
  categoryFields,
  type CategoryFields,
} from "./model";

const T = S.settings.categories;
const NAME_MAX = 100;

/**
 * Adds or edits a level-2 category: its name and the optional description the agent reads
 * when classifying. Mounted only while open. Editing submits only the changed fields
 * (`changes`), and closes without a request when nothing changed; adding gets all fields.
 */
export function CategoryDialog({
  title,
  initial,
  placeholder,
  submitLabel,
  pendingLabel,
  onSubmit,
  onClose,
}: {
  title: string;
  /** The category being edited; absent when adding. */
  initial?: CategoryFields;
  placeholder?: string;
  submitLabel: string;
  pendingLabel: string;
  onSubmit: (fields: CategoryFields, changes: Partial<CategoryFields>) => Promise<unknown>;
  onClose: () => void;
}) {
  useRestoreFocus();
  const descriptionId = useId();
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [error, setError] = useState<string>();
  const submit = useMutation({
    mutationFn: ({ fields, changes }: { fields: CategoryFields; changes: Partial<CategoryFields> }) =>
      onSubmit(fields, changes),
    onSuccess: onClose,
  });

  function handle(event: React.FormEvent) {
    event.preventDefault();
    const fields = categoryFields(name, description);
    if (!fields.name) {
      setError(S.common.nameRequired);
      return;
    }
    setError(undefined);
    const changes = initial ? categoryChanges(initial, fields) : fields;
    if (changes === null) onClose();
    else submit.mutate({ fields, changes });
  }

  return (
    <Dialog open onOpenChange={(open) => (!open && !submit.isPending ? onClose() : undefined)}>
      <DialogContent closeLabel={S.common.close} className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handle} noValidate className="grid gap-4">
          <FormField
            label={T.name}
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={placeholder}
            error={error}
            maxLength={NAME_MAX}
            autoFocus
          />
          <div className="space-y-1.5">
            <Label htmlFor={descriptionId}>{T.descriptionLabel}</Label>
            <Textarea
              id={descriptionId}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder={T.descriptionPlaceholder}
              maxLength={CATEGORY_DESCRIPTION_MAX}
              rows={3}
              aria-describedby={`${descriptionId}-note`}
            />
            <div id={`${descriptionId}-note`} className="flex gap-3 text-xs text-muted-foreground">
              <p className="flex-1">{T.descriptionHint}</p>
              <p className="num shrink-0">
                {T.descriptionCount(description.length, CATEGORY_DESCRIPTION_MAX)}
              </p>
            </div>
          </div>
          <FormError message={submit.isError ? errorMessage(submit.error) : null} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={submit.isPending}>
              {S.common.cancel}
            </Button>
            <Button type="submit" disabled={submit.isPending}>
              {submit.isPending ? pendingLabel : submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
