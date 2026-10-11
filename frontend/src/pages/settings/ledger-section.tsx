import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PencilIcon, PlusIcon } from "lucide-react";
import { useId, useState } from "react";

import { errorMessage, type Schemas } from "@/api/client";
import {
  categoriesQuery,
  createBudgetAccount,
  createChannel,
  keys,
  renameBudgetAccount,
  renameChannel,
  updateSettings,
} from "@/api/queries";
import { CopyButton } from "@/components/copy-button";
import { CurrencySelect } from "@/components/currency-select";
import { FormError } from "@/components/form-field";
import { NameDialog } from "@/components/name-dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { DEFAULT_CURRENCY } from "@/lib/currency";
import { S } from "@/strings.zh";

import { leafCounts } from "./model";
import { SectionCard } from "./section-card";

const C = S.settings.currency;
const B = S.settings.budgetAccounts;
const P = S.settings.channels;

/** The base currency. Changing it relabels every amount; nothing is converted. */
function CurrencyCard({ settings }: { settings: Schemas["SettingsOut"] }) {
  const queryClient = useQueryClient();
  const id = useId();
  const saved = settings.currency ?? DEFAULT_CURRENCY;
  const [currency, setCurrency] = useState(saved);
  const save = useMutation({
    mutationFn: updateSettings,
    onSuccess: (next) => {
      queryClient.setQueryData(keys.settings, next);
      // Budgets and summaries carry the currency they are shown in.
      return queryClient.invalidateQueries({ queryKey: keys.ledger });
    },
  });
  const changed = currency !== saved;

  return (
    <SectionCard title={C.title} description={C.description}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (changed) save.mutate({ currency });
        }}
        noValidate
        className="space-y-3 border-t px-4 py-4 sm:px-5"
      >
        <Label htmlFor={id}>{C.label}</Label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <CurrencySelect
            id={id}
            value={currency}
            onChange={(next) => {
              save.reset();
              setCurrency(next);
            }}
            className="w-full sm:max-w-xs"
          />
          <Button type="submit" disabled={!changed || save.isPending}>
            {save.isPending ? C.saving : C.save}
          </Button>
        </div>
        {changed ? <p className="text-xs text-warning-foreground">{C.warning}</p> : null}
        {save.isSuccess && !changed ? (
          <p role="status" className="text-xs text-positive">
            {C.saved}
          </p>
        ) : null}
        <FormError message={save.isError ? errorMessage(save.error) : null} />
      </form>
    </SectionCard>
  );
}

/** One row per budget account: name, ID and how many level-2 categories it holds; rename. */
function BudgetAccountsCard({ budgetAccounts }: { budgetAccounts: readonly Schemas["BudgetAccountOut"][] }) {
  const queryClient = useQueryClient();
  const tree = useQuery(categoriesQuery());
  const counts = tree.data ? leafCounts(tree.data) : null;
  const [adding, setAdding] = useState(false);
  const [renaming, setRenaming] = useState<Schemas["BudgetAccountOut"] | null>(null);

  return (
    <SectionCard
      title={B.title}
      description={B.description}
      action={
        <Button size="sm" onClick={() => setAdding(true)}>
          <PlusIcon />
          {B.add}
        </Button>
      }
    >
      <ul>
        {budgetAccounts.map((account) => (
          <li key={account.id} className="flex items-center gap-3 border-t px-4 py-3 sm:px-5">
            <div className="min-w-0 flex-1">
              <div className="truncate font-medium">{account.name}</div>
              <div className="num text-xs text-muted-foreground">
                {B.id(account.id)}
                {counts ? ` · ${B.leafCount(counts.get(account.id) ?? 0)}` : null}
              </div>
            </div>
            <Button
              variant="ghost"
              size="icon-sm"
              className="text-muted-foreground"
              aria-label={B.rename(account.name)}
              title={B.rename(account.name)}
              onClick={() => setRenaming(account)}
            >
              <PencilIcon />
            </Button>
          </li>
        ))}
      </ul>
      {adding ? (
        <NameDialog
          title={B.addTitle}
          label={B.name}
          placeholder={B.namePlaceholder}
          submitLabel={B.create}
          pendingLabel={B.creating}
          onSubmit={async (name) => {
            await createBudgetAccount({ name });
            await queryClient.invalidateQueries({ queryKey: keys.budgetAccounts });
          }}
          onClose={() => setAdding(false)}
        />
      ) : null}
      {renaming ? (
        <NameDialog
          title={B.renameTitle}
          label={B.name}
          initial={renaming.name}
          submitLabel={S.common.save}
          pendingLabel={S.common.saving}
          onSubmit={async (name) => {
            await renameBudgetAccount(renaming.id, { name });
            // The name also appears in the category tree, budgets and transactions.
            await Promise.all([
              queryClient.invalidateQueries({ queryKey: keys.budgetAccounts }),
              queryClient.invalidateQueries({ queryKey: keys.ledger }),
            ]);
          }}
          onClose={() => setRenaming(null)}
        />
      ) : null}
    </SectionCard>
  );
}

/** One row per payment channel: name and the ID an agent submits to (copyable); rename. */
function ChannelsCard({ channels }: { channels: readonly Schemas["ChannelOut"][] }) {
  const queryClient = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [renaming, setRenaming] = useState<Schemas["ChannelOut"] | null>(null);

  return (
    <SectionCard
      title={P.title}
      description={P.description}
      action={
        <Button size="sm" onClick={() => setAdding(true)}>
          <PlusIcon />
          {P.add}
        </Button>
      }
    >
      <ul>
        {channels.map((channel) => (
          <li key={channel.id} className="flex items-center gap-3 border-t px-4 py-3 sm:px-5">
            <div className="min-w-0 flex-1">
              <div className="truncate font-medium">{channel.name}</div>
              <div className="num text-xs text-muted-foreground">{P.id(channel.id)}</div>
            </div>
            <CopyButton value={String(channel.id)} label={P.idLabel(channel.name)} variant="ghost" />
            <Button
              variant="ghost"
              size="icon-sm"
              className="text-muted-foreground"
              aria-label={P.rename(channel.name)}
              title={P.rename(channel.name)}
              onClick={() => setRenaming(channel)}
            >
              <PencilIcon />
            </Button>
          </li>
        ))}
      </ul>
      {adding ? (
        <NameDialog
          title={P.addTitle}
          label={P.name}
          placeholder={P.namePlaceholder}
          submitLabel={P.create}
          pendingLabel={P.creating}
          onSubmit={async (name) => {
            await createChannel({ name });
            await queryClient.invalidateQueries({ queryKey: keys.channels });
          }}
          onClose={() => setAdding(false)}
        />
      ) : null}
      {renaming ? (
        <NameDialog
          title={P.renameTitle}
          label={P.name}
          initial={renaming.name}
          submitLabel={S.common.save}
          pendingLabel={S.common.saving}
          onSubmit={async (name) => {
            await renameChannel(renaming.id, { name });
            // The name also appears on every transaction of the channel.
            await Promise.all([
              queryClient.invalidateQueries({ queryKey: keys.channels }),
              queryClient.invalidateQueries({ queryKey: keys.transactions }),
            ]);
          }}
          onClose={() => setRenaming(null)}
        />
      ) : null}
    </SectionCard>
  );
}

/**
 * The ledger's setup: base currency, budget accounts and payment channels. Budget
 * accounts and channels can be added and renamed, not deleted (PRD D12).
 */
export function LedgerSection({
  settings,
  budgetAccounts,
  channels,
}: {
  settings: Schemas["SettingsOut"];
  budgetAccounts: readonly Schemas["BudgetAccountOut"][];
  channels: readonly Schemas["ChannelOut"][];
}) {
  return (
    <div className="space-y-5">
      <CurrencyCard settings={settings} />
      <BudgetAccountsCard budgetAccounts={budgetAccounts} />
      <ChannelsCard channels={channels} />
    </div>
  );
}
