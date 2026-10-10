import { useMutation, useQueryClient } from "@tanstack/react-query";
import { PencilIcon, PlusIcon } from "lucide-react";
import { useId, useState } from "react";

import { errorMessage, type Schemas } from "@/api/client";
import { createAccount, keys, renameAccount } from "@/api/queries";
import { type CurrencyCode, CurrencySelect } from "@/components/currency-select";
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
import { Label } from "@/components/ui/label";
import { useRestoreFocus } from "@/hooks/use-restore-focus";
import { S } from "@/strings.zh";

import { NameDialog } from "./name-dialog";
import { SectionCard } from "./section-card";

const T = S.settings.accounts;

function currencyName(code: string): string {
  return code in S.currencies ? S.currencies[code as CurrencyCode] : code;
}

function AddAccountDialog({ onClose }: { onClose: () => void }) {
  useRestoreFocus();
  const queryClient = useQueryClient();
  const currencyId = useId();
  const [name, setName] = useState("");
  const [currency, setCurrency] = useState<CurrencyCode>("CNY");
  const [nameError, setNameError] = useState<string>();
  const create = useMutation({
    mutationFn: createAccount,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: keys.accounts });
      onClose();
    },
  });

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = name.trim();
    setNameError(trimmed ? undefined : S.common.nameRequired);
    if (trimmed) create.mutate({ name: trimmed, currency });
  }

  return (
    <Dialog open onOpenChange={(open) => (!open && !create.isPending ? onClose() : undefined)}>
      <DialogContent closeLabel={S.common.close} className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{T.addTitle}</DialogTitle>
          <DialogDescription>{T.description}</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} noValidate className="grid gap-4">
          <FormField
            label={T.name}
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={T.namePlaceholder}
            error={nameError}
            maxLength={100}
            autoFocus
          />
          <div className="space-y-1.5">
            <Label htmlFor={currencyId}>{T.currency}</Label>
            <CurrencySelect id={currencyId} value={currency} onChange={setCurrency} />
            <p className="text-xs text-muted-foreground">{T.currencyHint}</p>
          </div>
          <FormError message={create.isError ? errorMessage(create.error) : null} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={create.isPending}>
              {S.common.cancel}
            </Button>
            <Button type="submit" disabled={create.isPending}>
              {create.isPending ? T.creating : T.create}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Accounts: add (name + currency) and rename. There is no delete (parent PRD R8). */
export function AccountsSection({ accounts }: { accounts: readonly Schemas["AccountOut"][] }) {
  const queryClient = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [renaming, setRenaming] = useState<Schemas["AccountOut"] | null>(null);

  return (
    <SectionCard
      title={T.title}
      description={T.description}
      action={
        <Button size="sm" onClick={() => setAdding(true)}>
          <PlusIcon />
          {T.add}
        </Button>
      }
    >
      <ul>
        {accounts.map((account) => (
          <li key={account.id} className="flex items-center gap-3 border-t px-4 py-3 sm:px-5">
            <div className="min-w-0 flex-1">
              <div className="truncate font-medium">{account.name}</div>
              <div className="num text-xs text-muted-foreground">
                {account.currency} · {currencyName(account.currency)} · {T.id(account.id)}
              </div>
            </div>
            <Button
              variant="ghost"
              size="icon-sm"
              className="text-muted-foreground"
              aria-label={T.rename(account.name)}
              title={T.rename(account.name)}
              onClick={() => setRenaming(account)}
            >
              <PencilIcon />
            </Button>
          </li>
        ))}
      </ul>
      {adding ? <AddAccountDialog onClose={() => setAdding(false)} /> : null}
      {renaming ? (
        <NameDialog
          title={T.renameTitle}
          label={T.name}
          initial={renaming.name}
          submitLabel={S.common.save}
          pendingLabel={S.common.saving}
          onSubmit={async (name) => {
            await renameAccount(renaming.id, { name });
            await queryClient.invalidateQueries({ queryKey: keys.accounts });
          }}
          onClose={() => setRenaming(null)}
        />
      ) : null}
    </SectionCard>
  );
}
