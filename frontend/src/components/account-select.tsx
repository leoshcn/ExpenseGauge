import type { Schemas } from "@/api/client";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { S } from "@/strings.zh";

/**
 * The account picker in every page header. Pages keep the chosen account in the URL
 * (`?account=<id>`, read by `useSelectedAccount` in hooks/use-search-state.ts).
 */
export function AccountSelect({
  accounts,
  value,
  onChange,
}: {
  accounts: readonly Schemas["AccountOut"][];
  value: number;
  onChange: (id: number) => void;
}) {
  return (
    <Select value={String(value)} onValueChange={(id) => onChange(Number(id))}>
      <SelectTrigger aria-label={S.account.label} className="max-w-[60vw] min-w-40 bg-card">
        <SelectValue />
      </SelectTrigger>
      <SelectContent align="end" position="popper">
        {accounts.map((account) => (
          <SelectItem key={account.id} value={String(account.id)}>
            <span className="truncate">{account.name}</span>
            <span className="num text-xs text-muted-foreground">{account.currency}</span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
