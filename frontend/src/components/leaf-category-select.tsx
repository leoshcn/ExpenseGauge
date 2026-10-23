import type { Schemas } from "@/api/client";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/** Choosing one level-2 category from the tree, grouped under its level-1 category. */
export function LeafCategorySelect({
  id,
  tree,
  value,
  onChange,
  placeholder,
  invalid,
}: {
  id: string;
  tree: Schemas["CategoryTree"];
  value: number | null;
  onChange: (categoryId: number) => void;
  placeholder: string;
  invalid?: boolean;
}) {
  return (
    <Select value={value === null ? "" : String(value)} onValueChange={(next) => onChange(Number(next))}>
      <SelectTrigger id={id} className="w-full" aria-invalid={invalid || undefined}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent position="popper" className="max-h-72">
        {tree.categories
          .filter((parent) => parent.children.length > 0)
          .map((parent) => (
            <SelectGroup key={parent.id}>
              <SelectLabel>{parent.name}</SelectLabel>
              {parent.children.map((child) => (
                <SelectItem key={child.id} value={String(child.id)} className="pl-4">
                  {child.name}
                </SelectItem>
              ))}
            </SelectGroup>
          ))}
      </SelectContent>
    </Select>
  );
}
