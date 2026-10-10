import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { S } from "@/strings.zh";

export type CurrencyCode = keyof typeof S.currencies;
const CURRENCIES = Object.keys(S.currencies) as CurrencyCode[];

/** The currencies offered when an account is created (onboarding and settings). */
export function CurrencySelect({
  id,
  value,
  onChange,
}: {
  id: string;
  value: CurrencyCode;
  onChange: (value: CurrencyCode) => void;
}) {
  return (
    <Select value={value} onValueChange={(next) => onChange(next as CurrencyCode)}>
      <SelectTrigger id={id} className="w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {CURRENCIES.map((code) => (
          <SelectItem key={code} value={code}>
            <span className="num w-9 text-muted-foreground">{code}</span>
            {S.currencies[code]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
