import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { currencyName, CURRENCIES } from "@/lib/currency";

/**
 * The base currency picker (onboarding and settings). A code that is not in the offered
 * list (set through the API) is still shown, so the select never appears empty.
 */
export function CurrencySelect({
  id,
  value,
  onChange,
  className,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  className?: string;
}) {
  const codes: readonly string[] = CURRENCIES.includes(value) ? CURRENCIES : [value, ...CURRENCIES];
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger id={id} className={className ?? "w-full"}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {codes.map((code) => (
          <SelectItem key={code} value={code}>
            <span className="num w-9 text-muted-foreground">{code}</span>
            {currencyName(code)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
