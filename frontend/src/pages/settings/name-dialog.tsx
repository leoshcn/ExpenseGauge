import { useMutation } from "@tanstack/react-query";
import { useState } from "react";

import { errorMessage } from "@/api/client";
import { FormError, FormField } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useRestoreFocus } from "@/hooks/use-restore-focus";
import { S } from "@/strings.zh";

const NAME_MAX = 100;

/**
 * Asks for one name: adding a category, renaming an account or a category. Mounted only
 * while open, so it always starts from `initial`. Closes on success; the backend's message
 * (for example `CATEGORY_NAME_TAKEN`) is shown in place on failure.
 */
export function NameDialog({
  title,
  description,
  label,
  placeholder,
  initial = "",
  submitLabel,
  pendingLabel,
  onSubmit,
  onClose,
}: {
  title: string;
  description?: string;
  label: string;
  placeholder?: string;
  initial?: string;
  submitLabel: string;
  pendingLabel: string;
  onSubmit: (name: string) => Promise<unknown>;
  onClose: () => void;
}) {
  useRestoreFocus();
  const [name, setName] = useState(initial);
  const [error, setError] = useState<string>();
  const submit = useMutation({ mutationFn: onSubmit, onSuccess: onClose });

  function handle(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setError(S.common.nameRequired);
      return;
    }
    setError(undefined);
    if (trimmed === initial) onClose();
    else submit.mutate(trimmed);
  }

  return (
    <Dialog open onOpenChange={(open) => (!open && !submit.isPending ? onClose() : undefined)}>
      <DialogContent closeLabel={S.common.close} className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : null}
        </DialogHeader>
        <form onSubmit={handle} noValidate className="grid gap-4">
          <FormField
            label={label}
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={placeholder}
            error={error}
            maxLength={NAME_MAX}
            autoFocus
          />
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
