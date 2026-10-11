import { cn } from "cn";
import { XIcon } from "lucide-react";
import { useId } from "react";

import type { Schemas } from "@/api/client";
import { Input } from "@/components/ui/input";
import { formatMonth } from "@/lib/date";
import { currencySymbol, formatMoney } from "@/lib/money";
import { S } from "@/strings.zh";

import {
  type BudgetDraft,
  type BudgetGroup,
  inputText,
  rowState,
  sumByPeriod,
} from "./model";

const T = S.budgets;

type Period = Schemas["BudgetLine"]["period"];

/** "/月" or "/年" after an amount (R2.3). */
function Per({ period, className }: { period: Period; className?: string }) {
  return <span className={cn("ml-0.5 text-xs font-normal text-muted-foreground", className)}>{T.per[period]}</span>;
}

/**
 * A subtotal or total: as before when every line is monthly; otherwise the monthly and the
 * annual sums apart, each with its period, since they cannot be added.
 */
function PeriodFigure({
  sums,
  money,
}: {
  sums: { month?: string | null; year?: string | null };
  money: (value: string) => string;
}) {
  const figure = (value: string | null) =>
    value === null ? <span className="text-xs font-normal text-muted-foreground">{T.noBudget}</span> : money(value);
  if (sums.year === undefined) return figure(sums.month ?? null);
  const parts = (["month", "year"] as const).filter((period) => sums[period] !== undefined);
  return (
    <span className="inline-flex flex-col items-end">
      {parts.map((period) => (
        <span key={period} className="whitespace-nowrap">
          {figure(sums[period] ?? null)}
          <Per period={period} />
        </span>
      ))}
    </span>
  );
}

/** The amount in force for the month, and since when; or "未设预算". */
function InForce({ line, money }: { line: Schemas["BudgetLine"]; money: (v: string) => string }) {
  if (line.amount === null) return <span className="text-muted-foreground">{T.noBudget}</span>;
  const since = line.effective_from ? formatMonth(line.effective_from) : null;
  return (
    <>
      <div className="num">
        <span>{money(line.amount)}</span>
        <Per period={line.period} />
      </div>
      {since ? <div className="num text-xs whitespace-nowrap text-muted-foreground">{T.since(since)}</div> : null}
    </>
  );
}

function AmountInput({
  line,
  draft,
  currency,
  onChange,
}: {
  line: Schemas["BudgetLine"];
  draft: BudgetDraft;
  currency: string;
  onChange: (text: string) => void;
}) {
  const id = useId();
  const text = inputText(line, draft);
  const { parsed, changed } = rowState(line, draft);
  const money = (value: string) => formatMoney(value, currency);
  const note = !parsed.valid
    ? T.invalid
    : changed
      ? T.was(line.amount === null ? T.noBudget : money(line.amount))
      : null;

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-1">
        <div className="relative w-28 sm:w-40">
          <span
            aria-hidden="true"
            className="num pointer-events-none absolute inset-y-0 left-2.5 flex sm:left-3 items-center text-muted-foreground"
          >
            {currencySymbol(currency)}
          </span>
          <Input
            id={id}
            value={text}
            onChange={(event) => onChange(event.target.value)}
            inputMode="decimal"
            autoComplete="off"
            placeholder={T.noBudget}
            aria-label={T.amountLabel(line.category_name)}
            aria-invalid={parsed.valid ? undefined : true}
            aria-describedby={note ? `${id}-note` : undefined}
            className={cn(
              "num bg-card pr-8 pl-7 text-right placeholder:text-left placeholder:text-xs sm:pl-9",
              currencySymbol(currency).length > 1 && "pl-10 sm:pl-11",
              changed && parsed.valid && "border-primary",
            )}
          />
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-y-0 right-2.5 flex items-center text-xs text-muted-foreground"
          >
            {T.per[line.period]}
          </span>
        </div>
        <button
          type="button"
          onClick={() => onChange("")}
          aria-label={T.clear(line.category_name)}
          title={T.clear(line.category_name)}
          className={cn(
            "flex size-7 shrink-0 items-center sm:size-8 justify-center rounded-md text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50",
            text === "" && "invisible",
          )}
          tabIndex={text === "" ? -1 : undefined}
        >
          <XIcon className="size-4" />
        </button>
      </div>
      {note ? (
        <p
          id={`${id}-note`}
          className={cn("num mr-8 text-right text-xs sm:mr-9", parsed.valid ? "text-muted-foreground" : "text-over")}
        >
          {note}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Level-2 categories grouped under level-1, with the amount in force for the chosen month
 * and an input each. Level-1 rows and the total are computed from the inputs, never typed.
 */
export function BudgetTable({
  groups,
  draft,
  currency,
  year,
  showBudgetAccount = false,
  onChange,
  className,
}: {
  groups: readonly BudgetGroup[];
  draft: BudgetDraft;
  currency: string;
  /** Year of the chosen month: the year an annual line's amount applies to. */
  year: number;
  /** Name each row's budget account (the "全部" view, where rows of several are mixed). */
  showBudgetAccount?: boolean;
  onChange: (categoryId: number, text: string) => void;
  className?: string;
}) {
  const money = (value: string) => formatMoney(value, currency);
  const total = (
    <PeriodFigure sums={sumByPeriod(groups.flatMap((group) => group.lines), draft)} money={money} />
  );
  const heading = "px-3 py-2.5 text-xs font-medium text-muted-foreground";

  return (
    <section className={cn("overflow-hidden rounded-xl border bg-card shadow-card", className)}>
      <div className="px-4 py-4 sm:px-5">
        <h2 className="text-base font-semibold">{T.listTitle}</h2>
        <p className="text-xs text-muted-foreground">{T.subtotalHint}</p>
      </div>
      <table className="w-full border-collapse">
        <thead>
          <tr className="border-t bg-muted/40">
            <th scope="col" className={cn(heading, "px-4 text-left sm:px-5")}>
              {T.columns.category}
            </th>
            <th scope="col" className={cn(heading, "hidden text-right md:table-cell")}>
              {T.columns.current}
            </th>
            <th scope="col" className={cn(heading, "pr-4 text-right sm:pr-5")}>
              {T.columns.amount}
            </th>
          </tr>
        </thead>
        {groups.map((group) => (
          <tbody key={group.id}>
            <tr className="border-t bg-muted/40">
              <th scope="rowgroup" colSpan={2} className="px-4 py-2.5 text-left font-medium sm:px-5 max-md:hidden">
                {group.name}
              </th>
              <th scope="rowgroup" className="px-4 py-2.5 text-left font-medium sm:px-5 md:hidden">
                {group.name}
              </th>
              <td className="num px-4 py-2.5 text-right font-medium sm:pr-[3.75rem]">
                {group.lines.length === 0 ? null : (
                  <>
                    <span className="mr-2 text-xs font-normal text-muted-foreground">{T.subtotal}</span>
                    <PeriodFigure sums={sumByPeriod(group.lines, draft)} money={money} />
                  </>
                )}
              </td>
            </tr>
            {group.lines.length === 0 ? (
              <tr className="border-t">
                <td colSpan={3} className="px-4 py-3 pl-11 text-xs text-warning-foreground sm:px-5 sm:pl-12">
                  {T.noChildren}
                </td>
              </tr>
            ) : (
              group.lines.map((line) => {
                const { changed } = rowState(line, draft);
                return (
                    <tr
                      key={line.category_id}
                      className={cn(
                        "border-t",
                        // An edited row carries a brand-coloured edge until it is saved.
                        changed && "shadow-[inset_3px_0_0_var(--primary)]",
                      )}
                    >
                      <th scope="row" className="px-4 py-3 pl-6 text-left align-top font-normal sm:px-5 sm:pl-12">
                        <div className="flex items-center gap-2 pt-1.5">
                          <span className="min-w-0 break-words">{line.category_name}</span>
                          {changed ? (
                            <span className="shrink-0 rounded-full bg-accent px-1.5 max-sm:hidden text-[11px] leading-[1.125rem] font-medium text-accent-foreground">
                              {T.changed}
                            </span>
                          ) : null}
                        </div>
                        {showBudgetAccount ? (
                          <div className="mt-0.5 text-xs text-muted-foreground">
                            <span className="sr-only">{T.budgetAccountLabel}</span>
                            {line.budget_account_name}
                          </div>
                        ) : null}
                        {line.period === "year" ? (
                          <div className="mt-0.5 text-xs text-accent-foreground">{T.annualHint(year)}</div>
                        ) : null}
                        <div className="mt-0.5 text-xs text-muted-foreground md:hidden">
                          {line.amount === null ? (
                            T.noBudget
                          ) : (
                            <InForce line={line} money={money} />
                          )}
                        </div>
                      </th>
                      <td className="hidden px-3 py-3 text-right align-top md:table-cell">
                        <div className="pt-1">
                          <InForce line={line} money={money} />
                        </div>
                      </td>
                      <td className="py-3 pr-2 pl-1 align-top sm:pr-3">
                        <AmountInput
                          line={line}
                          draft={draft}
                          currency={currency}
                          onChange={(text) => onChange(line.category_id, text)}
                        />
                      </td>
                    </tr>
                );
              })
            )}
          </tbody>
        ))}
        <tfoot>
          <tr className="border-t font-medium">
            <th scope="row" colSpan={2} className="px-4 py-3 text-left sm:px-5 max-md:hidden">
              {T.total}
            </th>
            <th scope="row" className="px-4 py-3 text-left sm:px-5 md:hidden">
              {T.total}
            </th>
            <td className="num px-4 py-3 text-right sm:pr-[3.75rem]">{total}</td>
          </tr>
        </tfoot>
      </table>
    </section>
  );
}
