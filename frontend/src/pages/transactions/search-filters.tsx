import { cn } from "cn";
import { CalendarIcon, PencilIcon, SearchIcon, TagIcon, XIcon } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

import type { Schemas } from "@/api/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useHotkey } from "@/hooks/use-hotkey";
import { formatDay } from "@/lib/date";
import { S } from "@/strings.zh";

import { moneyParam } from "./model";

const T = S.transactions.filters;
const SEARCH_DELAY_MS = 300;

/** What a change of these filters sets in the URL; `null` (or `[]`) removes it. */
export type SearchChange = {
  q?: string | null;
  min?: string | null;
  max?: string | null;
  tag?: string[];
  from?: string | null;
  to?: string | null;
};

/** Typed text, sent once the user pauses; "/" focuses it from anywhere on the page. */
function SearchBox({ value, onChange }: { value: string | null; onChange: (q: string | null) => void }) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [text, setText] = useState(value ?? "");
  // The URL changed from elsewhere ("清除筛选", a tag link): show that, keeping focus.
  const [shown, setShown] = useState(value);
  if (shown !== value) {
    setShown(value);
    if (text.trim() !== (value ?? "")) setText(value ?? "");
  }
  const latest = useRef(onChange);
  useEffect(() => {
    latest.current = onChange;
  });
  useEffect(() => {
    if (text.trim() === (value ?? "")) return;
    const timer = setTimeout(() => latest.current(text.trim() === "" ? null : text.trim()), SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [text, value]);
  useHotkey({ key: "/" }, () => input.current?.focus());

  return (
    <div className="w-full min-w-0 space-y-1.5 sm:w-auto sm:max-w-sm sm:flex-1">
      <Label htmlFor={id} className="text-xs text-muted-foreground">
        {T.search}
      </Label>
      <div className="relative">
        <SearchIcon
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 left-2.5 my-auto size-4 text-muted-foreground"
        />
        <Input
          ref={input}
          id={id}
          type="search"
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") onChange(text.trim() === "" ? null : text.trim());
            if (event.key === "Escape") input.current?.blur();
          }}
          placeholder={T.searchPlaceholder}
          maxLength={100}
          className="bg-card pl-8"
        />
      </div>
    </div>
  );
}

/** One bound of the amount range: applied on blur or Enter; anything unreadable clears it. */
function AmountBound({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string | null;
  onChange: (value: string | null) => void;
}) {
  const [text, setText] = useState(value ?? "");
  const commit = () => {
    const next = moneyParam(text.trim().replace(/[,，]/g, ""));
    if (next !== value) onChange(next);
    if (next === null) setText("");
  };
  return (
    <Input
      value={text}
      onChange={(event) => setText(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => (event.key === "Enter" ? commit() : undefined)}
      inputMode="decimal"
      aria-label={label}
      placeholder={label}
      className="num w-24 bg-card text-right"
    />
  );
}

/** Any of several tags; each can be renamed everywhere from here. */
function TagFilter({
  tags,
  selected,
  onChange,
  onRename,
}: {
  tags: readonly Schemas["TagCount"][];
  selected: readonly string[];
  onChange: (tags: string[]) => void;
  onRename: (tag: string) => void;
}) {
  const id = useId();
  const label =
    selected.length === 0 ? T.allTags : selected.length === 1 ? S.transactions.tag(selected[0]!) : T.tagsSelected(selected.length);
  return (
    <div className="min-w-0 space-y-1.5">
      <Label htmlFor={id} className="text-xs text-muted-foreground">
        {T.tags}
      </Label>
      <Popover>
        <PopoverTrigger asChild>
          <Button
            id={id}
            variant="outline"
            className={cn("w-full justify-start bg-card font-normal sm:w-40", selected.length > 0 && "border-primary")}
          >
            <TagIcon className="text-muted-foreground" />
            <span className="truncate">{label}</span>
          </Button>
        </PopoverTrigger>
        <PopoverContent className="max-h-80 overflow-y-auto p-1">
          {tags.length === 0 ? (
            <p className="px-2 py-3 text-center text-xs text-muted-foreground">{T.noTags}</p>
          ) : (
            <ul>
              {tags.map((tag) => {
                const checked = selected.includes(tag.tag);
                return (
                  <li key={tag.tag} className="flex items-center gap-1 rounded-sm hover:bg-muted">
                    <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 px-2 py-1.5">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() =>
                          onChange(checked ? selected.filter((name) => name !== tag.tag) : [...selected, tag.tag])
                        }
                        className="size-4 accent-primary"
                      />
                      <span className="min-w-0 flex-1 truncate">{S.transactions.tag(tag.tag)}</span>
                      <span className="num text-xs text-muted-foreground">{tag.count}</span>
                    </label>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={T.renameTag(tag.tag)}
                      title={T.renameTag(tag.tag)}
                      className="text-muted-foreground"
                      onClick={() => onRename(tag.tag)}
                    >
                      <PencilIcon />
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
        </PopoverContent>
      </Popover>
    </div>
  );
}

/**
 * Search text, amount range and tags, plus the day range a calendar link sets (shown as
 * a removable chip; there is no date picker on this page).
 */
export function SearchFilters({
  q,
  amountMin,
  amountMax,
  tags,
  selectedTags,
  dateFrom,
  dateTo,
  now,
  onChange,
  onRenameTag,
  className,
}: {
  q: string | null;
  amountMin: string | null;
  amountMax: string | null;
  tags: readonly Schemas["TagCount"][];
  selectedTags: readonly string[];
  dateFrom: string | null;
  dateTo: string | null;
  now: Date;
  onChange: (next: SearchChange) => void;
  onRenameTag: (tag: string) => void;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap items-end gap-3", className)}>
      <SearchBox value={q} onChange={(next) => onChange({ q: next })} />
      <div className="space-y-1.5" title={T.amountHint}>
        <div className="text-xs text-muted-foreground">{T.amount}</div>
        <div className="flex items-center gap-1.5">
          <AmountBound key={`min-${amountMin}`} label={T.amountMin} value={amountMin} onChange={(min) => onChange({ min })} />
          <span className="text-xs text-muted-foreground">{T.amountTo}</span>
          <AmountBound key={`max-${amountMax}`} label={T.amountMax} value={amountMax} onChange={(max) => onChange({ max })} />
        </div>
      </div>
      <TagFilter tags={tags} selected={selectedTags} onChange={(tag) => onChange({ tag })} onRename={onRenameTag} />
      {dateFrom !== null || dateTo !== null ? (
        <span className="num inline-flex h-9 items-center gap-1.5 rounded-md border border-primary bg-accent pr-1 pl-2.5 text-sm text-accent-foreground">
          <CalendarIcon className="size-4" aria-hidden="true" />
          {T.dateRange(
            dateFrom ? formatDay(dateFrom, now) : "…",
            dateTo ? formatDay(dateTo, now) : "…",
          )}
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={T.clearDateRange}
            title={T.clearDateRange}
            onClick={() => onChange({ from: null, to: null })}
          >
            <XIcon />
          </Button>
        </span>
      ) : null}
    </div>
  );
}
