import { cn } from "cn";
import { ChevronRightIcon, LoaderCircleIcon, RefreshCwIcon } from "lucide-react";
import { Fragment, useId, useRef, useState } from "react";
import { Link } from "react-router";

import { errorMessage, type Schemas } from "@/api/client";
import { Button } from "@/components/ui/button";
import { useGridMonthCount } from "@/hooks/use-grid-month-count";
import { rolloverBudget, usage } from "@/lib/budget";
import { formatMonth } from "@/lib/date";
import { currencySymbol, formatAmount, toCents } from "@/lib/money";
import { parseMonth } from "@/lib/month";
import { parseBudgetInput, sameBudget } from "@/pages/budgets/model";
import { S } from "@/strings.zh";

import { budgetEditText, type GridChild, type GridParent, mergeGridRows } from "./model";

const T = S.dashboard.grid;

/** Saves one level-2 category's budget from `month` on; rejects with the API error. */
export type SaveBudget = (categoryId: number, month: string, amount: string | null) => Promise<unknown>;

type Figures = { budget: string | null; actual: string; carry_in?: string | null };

const cellX = "px-1 sm:px-2.5";
/** The first column of each month carries the line that separates it from the month before. */
const monthStart = "border-l";

/**
 * A level-2 category's budget for one month, edited in place: a click (or Enter) opens an
 * input that takes amounts and calculations like the budgets page; Enter or leaving it
 * saves from that month on, Esc cancels, an empty input clears the budget.
 */
function BudgetCell({
  name,
  month,
  budget,
  currency,
  onSave,
}: {
  name: string;
  month: string;
  budget: string | null;
  currency: string;
  onSave: (amount: string | null) => Promise<unknown>;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState("");
  const [invalid, setInvalid] = useState(false);
  const [pending, setPending] = useState<string | null | undefined>(undefined);
  const [failure, setFailure] = useState<string | null>(null);
  // Set by Esc so the blur that follows does not save.
  const cancelled = useRef(false);
  const hintId = useId();
  const label = formatMonth(month);

  function open() {
    cancelled.current = false;
    setText(budgetEditText(budget));
    setInvalid(false);
    setFailure(null);
    setEditing(true);
  }

  function commit() {
    if (cancelled.current) return;
    const parsed = parseBudgetInput(text);
    if (!parsed.valid) {
      setInvalid(true);
      return;
    }
    setEditing(false);
    if (sameBudget(parsed.amount, budget)) return;
    setPending(parsed.amount);
    onSave(parsed.amount)
      .catch((error: unknown) => setFailure(T.saveFailed(errorMessage(error))))
      .finally(() => setPending(undefined));
  }

  const shown = pending !== undefined ? pending : budget;

  return (
    <div className="relative">
      {editing ? (
        <input
          // Opened by the user's click, so taking the focus is expected.
          autoFocus
          inputMode="decimal"
          value={text}
          aria-label={T.editBudget(name, label)}
          aria-invalid={invalid}
          aria-describedby={hintId}
          onChange={(event) => {
            setText(event.target.value);
            setInvalid(false);
          }}
          onFocus={(event) => event.target.select()}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              commit();
            } else if (event.key === "Escape") {
              event.preventDefault();
              cancelled.current = true;
              setEditing(false);
            }
          }}
          className={cn(
            "num h-7 w-full min-w-14 rounded-md border bg-background px-1 text-right text-xs sm:text-[13px] outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
            invalid && "border-destructive",
          )}
        />
      ) : (
        <button
          type="button"
          onClick={open}
          disabled={pending !== undefined}
          aria-label={T.editBudget(name, label)}
          className="num -mx-1 flex h-7 w-[calc(100%+0.5rem)] items-center justify-end gap-1 rounded-md px-1 text-right outline-none hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-70"
        >
          {pending !== undefined ? <LoaderCircleIcon className="size-3 animate-spin" aria-label={T.saving} /> : null}
          {shown === null ? (
            <span className="text-muted-foreground">{T.none}</span>
          ) : (
            <span className="amount">{formatAmount(shown, currency)}</span>
          )}
        </button>
      )}
      {editing ? (
        <p
          id={hintId}
          role={invalid ? "alert" : undefined}
          className={cn(
            "absolute top-full left-0 z-10 mt-1 w-56 whitespace-normal rounded-md border bg-popover p-2 text-left text-xs leading-5 font-normal text-popover-foreground shadow-md",
            invalid && "text-destructive",
          )}
        >
          {invalid ? T.invalid : T.editHint(label)}
        </p>
      ) : null}
      {failure ? (
        <p
          role="alert"
          className="absolute top-full left-0 z-10 mt-1 w-56 whitespace-normal rounded-md border bg-popover p-2 text-left text-xs leading-5 font-normal text-over shadow-md"
          onClick={() => setFailure(null)}
        >
          {failure}
        </p>
      ) : null}
    </div>
  );
}

/** What is left (or, for a rollover category, available), drawn as Actual does: a pill by state. */
function Remaining({ row, currency }: { row: Figures; currency: string }) {
  const carryIn = row.carry_in ?? null;
  const used = usage(carryIn === null ? row.budget : rolloverBudget(carryIn, row.budget), row.actual);
  if (used.remaining === null) return <span className="text-muted-foreground">{T.none}</span>;
  const positive = toCents(used.remaining) > 0;
  return (
    <span
      className={cn(
        "amount inline-block rounded-full px-1 leading-5 sm:px-1.5",
        used.state === "over" && "bg-over-soft font-medium text-over",
        used.state === "near" && "bg-warning-soft text-warning-foreground",
        used.state === "ok" && positive && "bg-positive-soft text-positive",
      )}
    >
      {used.state === "over" ? <span className="sr-only">{T.over}</span> : null}
      {formatAmount(used.remaining, currency)}
    </span>
  );
}

/** The three figures of one row in one month. */
function MonthCells({
  row,
  kind,
  month,
  selected,
  currency,
  categoryId,
  name,
  onSave,
}: {
  row: Figures | null;
  kind: "parent" | "child" | "total";
  month: string;
  selected: boolean;
  currency: string;
  categoryId?: number;
  name: string;
  onSave?: SaveBudget;
}) {
  const tone = selected && "bg-accent/30";
  const cell = cn("num text-right whitespace-nowrap", cellX, tone);
  if (row === null) {
    return (
      <>
        <td className={cn(cell, monthStart)} />
        <td className={cell} />
        <td className={cell} />
      </>
    );
  }
  const carryIn = row.carry_in ?? null;
  return (
    <>
      <td className={cn(cell, monthStart)}>
        {kind === "child" && onSave && categoryId !== undefined ? (
          <BudgetCell
            name={name}
            month={month}
            budget={row.budget}
            currency={currency}
            onSave={(amount) => onSave(categoryId, month, amount)}
          />
        ) : row.budget === null ? (
          <span className="text-muted-foreground">{T.none}</span>
        ) : (
          <span className="amount">{formatAmount(row.budget, currency)}</span>
        )}
      </td>
      <td className={cell}>
        {categoryId !== undefined ? (
          <Link
            to={`/transactions?month=${month}&category=${categoryId}`}
            aria-label={T.actualLink(name, formatMonth(month))}
            className={cn(
              "amount rounded-sm underline-offset-4 outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50",
              toCents(row.actual) === 0 && "text-muted-foreground",
            )}
          >
            {formatAmount(row.actual, currency)}
          </Link>
        ) : (
          <span className="amount">{formatAmount(row.actual, currency)}</span>
        )}
      </td>
      <td className={cell}>
        <Remaining row={row} currency={currency} />
        {carryIn !== null ? (
          <div className="amount text-[11px] leading-4 text-muted-foreground" title={S.dashboard.table.carryInHint}>
            {T.carryIn(formatAmount(carryIn, currency))}
          </div>
        ) : null}
      </td>
    </>
  );
}

function ParentRows({
  parent,
  months,
  selected,
  currency,
  open,
  onToggle,
  onSave,
}: {
  parent: GridParent;
  months: string[];
  selected: string;
  currency: string;
  open: boolean;
  onToggle: () => void;
  onSave: SaveBudget;
}) {
  return (
    <>
      <tr className="border-t bg-muted/20 font-medium">
        <th scope="row" className="max-w-0 py-2 pr-1 pl-3 text-left sm:px-5">
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              aria-expanded={open}
              aria-label={open ? S.dashboard.table.collapse(parent.name) : S.dashboard.table.expand(parent.name)}
              onClick={onToggle}
              className="-ml-1 flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-ring/50"
            >
              <ChevronRightIcon className={cn("size-4 transition-transform", open && "rotate-90")} />
            </button>
            <span className="min-w-0 truncate" title={parent.name}>
              {parent.name}
            </span>
          </div>
        </th>
        {months.map((month, index) => (
          <MonthCells
            key={month}
            row={parent.months[index] ?? null}
            kind="parent"
            month={month}
            selected={month === selected}
            currency={currency}
            categoryId={parent.category_id}
            name={parent.name}
          />
        ))}
      </tr>
      {open
        ? parent.children.map((child) => (
            <ChildRow
              key={child.category_id}
              child={child}
              months={months}
              selected={selected}
              currency={currency}
              onSave={onSave}
            />
          ))
        : null}
    </>
  );
}

function ChildRow({
  child,
  months,
  selected,
  currency,
  onSave,
}: {
  child: GridChild;
  months: string[];
  selected: string;
  currency: string;
  onSave: SaveBudget;
}) {
  const rollover = child.months.some((row) => row?.carry_in != null);
  return (
    <tr className="border-t">
      <th scope="row" className="max-w-0 py-1.5 pr-1 pl-8 text-left font-normal sm:pr-2 sm:pl-12">
        <div className="flex items-center gap-1.5">
          <span className="min-w-0 truncate" title={child.name}>
            {child.name}
          </span>
          {rollover ? (
            <span title={S.dashboard.table.rollover} className="shrink-0 text-muted-foreground">
              <RefreshCwIcon className="size-3" aria-hidden="true" />
              <span className="sr-only">{S.dashboard.table.rollover}</span>
            </span>
          ) : null}
        </div>
      </th>
      {months.map((month, index) => (
        <MonthCells
          key={month}
          row={child.months[index] ?? null}
          kind="child"
          month={month}
          selected={month === selected}
          currency={currency}
          categoryId={child.category_id}
          name={child.name}
          onSave={onSave}
        />
      ))}
    </tr>
  );
}

/**
 * The budget by category for the selected month and the months before it, side by side as
 * in Actual Budget's budget view: budget, spent and remaining per month, level-1 rows that
 * fold their level-2 rows, the month totals on top. Wide screens show three months, medium
 * ones two, phones the selected month only. Budgets are edited in place (`onSave`).
 * `details` are the grid's months, oldest first, ending at `selected`.
 */
export function BudgetGrid({
  details,
  current,
  onSave,
  className,
}: {
  details: readonly Schemas["MonthDetailOut"][];
  /** The current month, marked "本月". */
  current: string;
  onSave: SaveBudget;
  className?: string;
}) {
  const shown = details.slice(-useGridMonthCount());
  const selected = shown[shown.length - 1]!;
  const rows = mergeGridRows(shown);
  const currency = selected.currency;
  const [closed, setClosed] = useState<ReadonlySet<number>>(new Set());
  const allOpen = closed.size === 0;

  function toggle(id: number) {
    const next = new Set(closed);
    if (!next.delete(id)) next.add(id);
    setClosed(next);
  }

  const heading = cn("py-2 text-xs font-medium text-muted-foreground", cellX);

  // Not overflow-hidden: the edit hint under the last row must stay visible.
  return (
    <section className={cn("rounded-xl border bg-card shadow-card", className)}>
      <div className="flex items-center justify-between gap-3 px-4 py-3 sm:px-5">
        <div className="flex min-w-0 items-baseline gap-2">
          <h2 className="text-base font-semibold">{T.title}</h2>
          <p className="num truncate text-xs text-muted-foreground">
            {T.description(shown.length, currencySymbol(currency))}
          </p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="-mr-2 text-muted-foreground"
          onClick={() => setClosed(allOpen ? new Set(rows.map((row) => row.category_id)) : new Set())}
        >
          {allOpen ? S.dashboard.table.collapseAll : S.dashboard.table.expandAll}
        </Button>
      </div>
      <table className="w-full border-collapse text-xs sm:text-[13px]">
        <thead>
          <tr className="border-t bg-muted/40">
            <th scope="col" rowSpan={2} className={cn(heading, "w-[28%] pr-1 pl-3 text-left align-bottom sm:px-5")}>
              {T.category}
            </th>
            {shown.map((detail) => {
              const { year, month } = parseMonth(detail.month);
              const isSelected = detail === selected;
              return (
                <th
                  key={detail.month}
                  scope="colgroup"
                  colSpan={3}
                  className={cn(
                    "num border-l px-2.5 pt-2 text-center text-[13px] font-semibold",
                    isSelected && "bg-accent/30",
                  )}
                >
                  {S.dashboard.month.long(year, month)}
                  {detail.month === current ? (
                    <span className="ml-1.5 rounded-full bg-accent px-1.5 py-0.5 text-[11px] font-medium text-accent-foreground">
                      {T.current}
                    </span>
                  ) : null}
                </th>
              );
            })}
          </tr>
          <tr className="bg-muted/40">
            {shown.map((detail) => (
              <Fragment key={detail.month}>
                {[T.budget, T.actual, T.remaining].map((label, index) => (
                  <th
                    key={label}
                    scope="col"
                    className={cn(heading, "text-right", index === 0 && monthStart, detail === selected && "bg-accent/30")}
                  >
                    {label}
                  </th>
                ))}
              </Fragment>
            ))}
          </tr>
          <tr className="border-t font-medium">
            <th scope="row" className="max-w-0 py-2 pr-1 pl-3 text-left sm:px-5">
              {T.total}
            </th>
            {shown.map((detail) => (
              <MonthCells
                key={detail.month}
                row={detail}
                kind="total"
                month={detail.month}
                selected={detail === selected}
                currency={currency}
                name={T.total}
              />
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((parent) => (
            <ParentRows
              key={parent.category_id}
              parent={parent}
              months={shown.map((detail) => detail.month)}
              selected={selected.month}
              currency={currency}
              open={!closed.has(parent.category_id)}
              onToggle={() => toggle(parent.category_id)}
              onSave={onSave}
            />
          ))}
        </tbody>
      </table>
    </section>
  );
}
