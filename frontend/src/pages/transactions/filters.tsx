import { cn } from "cn";
import { useId } from "react";

import type { Schemas } from "@/api/client";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatMonth } from "@/lib/date";
import { S } from "@/strings.zh";

import { findCategory, monthOptions } from "./model";

const T = S.transactions.filters;
const ALL = "all";

/** Month and category filters. `null` is "all"; a level-1 category includes its children. */
export function Filters({
  tree,
  month,
  categoryId,
  now,
  onChange,
  className,
}: {
  tree: Schemas["CategoryTree"];
  month: string | null;
  categoryId: number | null;
  now: Date;
  onChange: (next: { month?: string | null; category?: number | null }) => void;
  className?: string;
}) {
  const monthId = useId();
  const categoryFieldId = useId();
  const found = categoryId === null ? null : findCategory(tree, categoryId);
  const categoryLabel = found
    ? found.child
      ? T.categoryOf(found.parent.name, found.child.name)
      : `${found.parent.name} · ${T.allOf}`
    : T.allCategories;

  return (
    <div className={cn("grid grid-cols-2 gap-3 sm:flex sm:items-end", className)}>
      <div className="min-w-0 space-y-1.5">
        <Label htmlFor={monthId} className="text-xs text-muted-foreground">
          {T.month}
        </Label>
        <Select
          value={month ?? ALL}
          onValueChange={(value) => onChange({ month: value === ALL ? null : value })}
        >
          <SelectTrigger id={monthId} className="num w-full bg-card sm:w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent position="popper" className="max-h-80">
            <SelectItem value={ALL}>{T.allMonths}</SelectItem>
            <SelectSeparator />
            {monthOptions(now, month).map((option) => (
              <SelectItem key={option} value={option} className="num">
                {formatMonth(option)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="min-w-0 space-y-1.5">
        <Label htmlFor={categoryFieldId} className="text-xs text-muted-foreground">
          {T.category}
        </Label>
        <Select
          value={categoryId === null ? ALL : String(categoryId)}
          onValueChange={(value) => onChange({ category: value === ALL ? null : Number(value) })}
        >
          <SelectTrigger id={categoryFieldId} className="w-full bg-card sm:w-56">
            <SelectValue>
              <span className="truncate">{categoryLabel}</span>
            </SelectValue>
          </SelectTrigger>
          <SelectContent position="popper" className="max-h-80">
            <SelectItem value={ALL}>{T.allCategories}</SelectItem>
            {tree.categories.map((parent) => (
              <SelectGroup key={parent.id} aria-label={parent.name}>
                <SelectSeparator />
                <SelectItem value={String(parent.id)} className="font-medium">
                  {parent.name}
                  <span className="text-xs font-normal text-muted-foreground">{T.allOf}</span>
                </SelectItem>
                {parent.children.map((child) => (
                  <SelectItem key={child.id} value={String(child.id)} className="pl-6">
                    {child.name}
                  </SelectItem>
                ))}
              </SelectGroup>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
