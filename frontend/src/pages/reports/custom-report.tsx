import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { cn } from "cn";
import { useId, useState } from "react";
import { Bar, BarChart, CartesianGrid, Line, LineChart, Pie, PieChart, XAxis, YAxis } from "recharts";
import { toast } from "sonner";

import { errorMessage, type Schemas } from "@/api/client";
import {
  type BudgetScope,
  deleteSavedReport,
  keys,
  reportSummaryQuery,
  saveReport,
  savedReportsQuery,
  updateSavedReport,
} from "@/api/queries";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { ErrorState } from "@/components/error-state";
import { NameDialog } from "@/components/name-dialog";
import { Button } from "@/components/ui/button";
import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectSeparator, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { usePrivacy } from "@/hooks/use-privacy";
import { formatMoney, formatMoneyCompact, formatPercent, toCents, toChartNumber } from "@/lib/money";
import { parseMonth } from "@/lib/month";
import { S } from "@/strings.zh";

import {
  CHARTS,
  type ChartGroup,
  chartGroups,
  configParams,
  GROUP_BYS,
  PRESETS,
  rangeMonths,
  type ReportConfig,
  sameConfig,
} from "./model";

const T = S.reports.custom;
const V = S.reports.saved;
const NONE = "none";

/** A labelled select of fixed options. */
function Field<V extends string>({
  label,
  value,
  options,
  onChange,
  className,
}: {
  label: string;
  value: V;
  options: readonly { value: V; label: string }[];
  onChange: (value: V) => void;
  className?: string;
}) {
  const id = useId();
  return (
    <div className={cn("min-w-0 space-y-1.5", className)}>
      <Label htmlFor={id} className="text-xs text-muted-foreground">
        {label}
      </Label>
      <Select value={value} onValueChange={(next) => onChange(next as V)}>
        <SelectTrigger id={id} className="w-full bg-card">
          <SelectValue />
        </SelectTrigger>
        <SelectContent position="popper">
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

const groupLabel = (group: { label: string | null }, groupBy: ReportConfig["group_by"]) =>
  group.label === null ? T.noTag : groupBy === "tag" ? T.tag(group.label) : group.label;

/** The chart of a report: bars or a donut for totals, stacked bars or lines by month. */
function ReportChart({
  report,
  config,
}: {
  report: Schemas["ReportOut"];
  config: ReportConfig;
}) {
  const { hidden } = usePrivacy();
  const groups = chartGroups(report.groups, report.months.length);
  if (groups.length === 0 || config.chart === "table") return null;
  const name = (group: ChartGroup) => (group.other ? T.other : groupLabel(group, config.group_by));
  const chartConfig: ChartConfig = Object.fromEntries(
    groups.map((group) => [group.key, { label: name(group), color: `var(--chart-${group.slot})` }]),
  );
  const money = (value: number) => (hidden ? S.privacy.hiddenTick : formatMoneyCompact(value, report.currency));
  const tooltip = (
    <ChartTooltip
      content={
        <ChartTooltipContent
          className="num"
          formatter={(value, itemName) => (
            <div className="flex w-full items-center justify-between gap-4">
              <span className="text-muted-foreground">{chartConfig[String(itemName)]?.label ?? String(itemName)}</span>
              <span className="amount font-medium">{formatMoney(Number(value).toFixed(2), report.currency)}</span>
            </div>
          )}
        />
      }
    />
  );

  if (config.mode === "total" && config.chart === "donut") {
    const data = groups.map((group) => ({ key: group.key, value: toChartNumber(group.amount), fill: `var(--color-${group.key})` }));
    return (
      <ChartContainer config={chartConfig} role="img" aria-label={T.ariaLabel} className="mx-auto aspect-square max-h-72">
        <PieChart>
          {tooltip}
          <Pie data={data} dataKey="value" nameKey="key" innerRadius="60%" strokeWidth={0} isAnimationActive={false} />
        </PieChart>
      </ChartContainer>
    );
  }
  if (config.mode === "total") {
    const data = groups.map((group) => ({ key: group.key, name: name(group), value: toChartNumber(group.amount), fill: `var(--color-${group.key})` }));
    return (
      <ChartContainer
        config={chartConfig}
        role="img"
        aria-label={T.ariaLabel}
        className="w-full"
        style={{ height: Math.max(160, groups.length * 36 + 40) }}
      >
        <BarChart data={data} layout="vertical" margin={{ left: 8, right: 16 }}>
          <CartesianGrid horizontal={false} stroke="var(--chart-grid)" />
          <XAxis type="number" tickFormatter={money} tickLine={false} axisLine={false} fontSize={12} className="num" />
          <YAxis type="category" dataKey="name" width={96} tickLine={false} axisLine={false} fontSize={12} />
          <ChartTooltip
            content={
              <ChartTooltipContent
                hideLabel
                className="num"
                formatter={(value, _name, item) => (
                  <div className="flex w-full items-center justify-between gap-4">
                    <span className="text-muted-foreground">{(item.payload as { name: string }).name}</span>
                    <span className="amount font-medium">{formatMoney(Number(value).toFixed(2), report.currency)}</span>
                  </div>
                )}
              />
            }
          />
          <Bar dataKey="value" radius={4} isAnimationActive={false} />
        </BarChart>
      </ChartContainer>
    );
  }
  const data = report.months.map((month, index) => ({
    month,
    ...Object.fromEntries(groups.map((group) => [group.key, toChartNumber(group.months[index] ?? "0.00")])),
  }));
  const axis = (
    <>
      <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
      <XAxis
        dataKey="month"
        tickFormatter={(month: string) => T.monthTick(parseMonth(month).month)}
        tickLine={false}
        axisLine={false}
        fontSize={12}
        className="num"
      />
      <YAxis tickFormatter={money} width={56} tickLine={false} axisLine={false} fontSize={12} className="num" />
      {tooltip}
    </>
  );
  return (
    <ChartContainer config={chartConfig} role="img" aria-label={T.ariaLabel} className="h-72 w-full">
      {config.chart === "line" ? (
        <LineChart data={data}>
          {axis}
          {groups.map((group) => (
            <Line
              key={group.key}
              dataKey={group.key}
              stroke={`var(--color-${group.key})`}
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
            />
          ))}
        </LineChart>
      ) : (
        <BarChart data={data}>
          {axis}
          {groups.map((group) => (
            <Bar key={group.key} dataKey={group.key} stackId="a" fill={`var(--color-${group.key})`} isAnimationActive={false} />
          ))}
        </BarChart>
      )}
    </ChartContainer>
  );
}

/** Every group with its amount, count and share; by month in the monthly mode. */
function ReportTable({ report, config }: { report: Schemas["ReportOut"]; config: ReportConfig }) {
  const money = (value: string) => formatMoney(value, report.currency);
  const totalCents = toCents(report.total.amount);
  const monthly = config.mode === "monthly";
  const heading = "px-3 py-2.5 text-xs font-medium text-muted-foreground whitespace-nowrap";
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse">
        <thead>
          <tr className="border-t bg-muted/40">
            <th scope="col" className={cn(heading, "px-4 text-left sm:px-5")}>
              {T.group}
            </th>
            {monthly
              ? report.months.map((month) => (
                  <th key={month} scope="col" className={cn(heading, "num text-right")}>
                    {T.monthTick(parseMonth(month).month)}
                  </th>
                ))
              : null}
            <th scope="col" className={cn(heading, "text-right")}>
              {T.amount}
            </th>
            <th scope="col" className={cn(heading, "text-right")}>
              {T.count}
            </th>
            <th scope="col" className={cn(heading, "pr-4 text-right sm:pr-5")}>
              {T.share}
            </th>
          </tr>
        </thead>
        <tbody>
          {report.groups.map((group) => (
            <tr key={group.key ?? "none"} className="border-t">
              <th scope="row" className="max-w-56 truncate px-4 py-2.5 text-left font-normal sm:px-5">
                {groupLabel(group, config.group_by)}
              </th>
              {monthly
                ? group.months.map((amount, index) => (
                    <td key={report.months[index]} className="num amount px-3 py-2.5 text-right whitespace-nowrap text-muted-foreground">
                      {money(amount)}
                    </td>
                  ))
                : null}
              <td className="num amount px-3 py-2.5 text-right font-medium whitespace-nowrap">{money(group.amount)}</td>
              <td className="num px-3 py-2.5 text-right text-muted-foreground">{group.count}</td>
              <td className="num px-3 py-2.5 pr-4 text-right text-muted-foreground sm:pr-5">
                {totalCents > 0 && toCents(group.amount) > 0 ? formatPercent(toCents(group.amount) / totalCents, true) : S.common.none}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t font-medium">
            <th scope="row" className="px-4 py-2.5 text-left sm:px-5">
              {T.total}
            </th>
            {monthly
              ? report.total.months.map((amount, index) => (
                  <td key={report.months[index]} className="num amount px-3 py-2.5 text-right whitespace-nowrap">
                    {money(amount)}
                  </td>
                ))
              : null}
            <td className="num amount px-3 py-2.5 text-right whitespace-nowrap">{money(report.total.amount)}</td>
            <td className="num px-3 py-2.5 text-right">{report.total.count}</td>
            <td className="pr-4 sm:pr-5" />
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

type SavedDialog = "save" | "saveAs" | "rename" | "delete" | null;

/** Choosing, saving, overwriting, renaming and deleting saved reports. */
function SavedReports({
  config,
  selectedId,
  onSelect,
}: {
  config: ReportConfig;
  selectedId: number | null;
  onSelect: (report: Schemas["SavedReportOut"] | null) => void;
}) {
  const id = useId();
  const queryClient = useQueryClient();
  const saved = useQuery(savedReportsQuery);
  const [dialog, setDialog] = useState<SavedDialog>(null);
  const selected = saved.data?.find((report) => report.id === selectedId) ?? null;
  const changed = selected !== null && !sameConfig(selected.config, config);
  const refresh = () => queryClient.invalidateQueries({ queryKey: keys.savedReports });
  const overwrite = useMutation({
    mutationFn: (report: Schemas["SavedReportOut"]) => updateSavedReport(report.id, { config }),
    onSuccess: async (report) => {
      toast.success(V.saved(report.name));
      await refresh();
    },
  });
  const remove = useMutation({
    mutationFn: (report: Schemas["SavedReportOut"]) => deleteSavedReport(report.id),
    onSuccess: async () => {
      setDialog(null);
      onSelect(null);
      await refresh();
    },
  });

  return (
    <div className="flex flex-wrap items-end gap-2">
      <div className="min-w-0 space-y-1.5">
        <Label htmlFor={id} className="text-xs text-muted-foreground">
          {V.label}
        </Label>
        <Select
          value={selected ? String(selected.id) : NONE}
          onValueChange={(value) => onSelect(saved.data?.find((report) => String(report.id) === value) ?? null)}
        >
          <SelectTrigger id={id} className="w-48 bg-card">
            <SelectValue>
              {selected ? `${selected.name}${changed ? V.unsaved : ""}` : V.none}
            </SelectValue>
          </SelectTrigger>
          <SelectContent position="popper">
            <SelectItem value={NONE}>{V.none}</SelectItem>
            {saved.data && saved.data.length > 0 ? <SelectSeparator /> : null}
            {saved.data?.map((report) => (
              <SelectItem key={report.id} value={String(report.id)}>
                {report.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {selected === null ? (
        <Button variant="outline" onClick={() => setDialog("save")}>
          {V.save}
        </Button>
      ) : (
        <>
          {changed ? (
            <>
              <Button onClick={() => overwrite.mutate(selected)} disabled={overwrite.isPending}>
                {V.overwrite}
              </Button>
              <Button variant="outline" onClick={() => onSelect(selected)}>
                {V.revert}
              </Button>
            </>
          ) : null}
          <Button variant="outline" onClick={() => setDialog("saveAs")}>
            {V.saveAs}
          </Button>
          <Button variant="ghost" onClick={() => setDialog("rename")}>
            {V.rename}
          </Button>
          <Button variant="ghost" className="text-over hover:bg-over-soft hover:text-over" onClick={() => setDialog("delete")}>
            {V.delete}
          </Button>
        </>
      )}
      {overwrite.isError ? <p role="alert" className="w-full text-sm text-over">{errorMessage(overwrite.error)}</p> : null}
      {dialog === "save" || dialog === "saveAs" ? (
        <NameDialog
          title={V.nameTitle}
          label={V.nameLabel}
          placeholder={V.namePlaceholder}
          submitLabel={V.save}
          pendingLabel={S.common.saving}
          onSubmit={async (name) => {
            const report = await saveReport({ name, config });
            toast.success(V.saved(report.name));
            await refresh();
            onSelect(report);
          }}
          onClose={() => setDialog(null)}
        />
      ) : null}
      {dialog === "rename" && selected ? (
        <NameDialog
          title={V.renameTitle}
          label={V.nameLabel}
          initial={selected.name}
          submitLabel={S.common.save}
          pendingLabel={S.common.saving}
          onSubmit={async (name) => {
            await updateSavedReport(selected.id, { name });
            await refresh();
          }}
          onClose={() => setDialog(null)}
        />
      ) : null}
      {dialog === "delete" && selected ? (
        <ConfirmDialog
          open
          onOpenChange={(open) => (open ? undefined : setDialog(null))}
          title={V.deleteTitle(selected.name)}
          description={V.deleteBody}
          confirmLabel={V.delete}
          pendingLabel={V.deleting}
          pending={remove.isPending}
          error={remove.isError ? errorMessage(remove.error) : null}
          onConfirm={() => remove.mutate(selected)}
        />
      ) : null}
    </div>
  );
}

/**
 * Spending grouped as the user chooses (category, counterparty, channel or tag), in total
 * or by month, over a range of months, as a chart and a table. The settings live in the
 * URL and can be saved by name.
 */
export function CustomReport({
  config,
  scope,
  savedId,
  now,
  onChange,
  onSelectSaved,
}: {
  config: ReportConfig;
  scope: BudgetScope;
  savedId: number | null;
  now: Date;
  /** URL parameters to merge (`configParams` of a whole config, or one field). */
  onChange: (params: Record<string, string | null>) => void;
  onSelectSaved: (report: Schemas["SavedReportOut"] | null) => void;
}) {
  const fromId = useId();
  const toId = useId();
  const { from, to } = rangeMonths(config.range, now);
  const report = useQuery({
    ...reportSummaryQuery(config.group_by, from, to, scope),
    placeholderData: keepPreviousData,
  });
  const set = (patch: Partial<ReportConfig>) => onChange(configParams({ ...config, ...patch }));

  return (
    <div className="space-y-5">
      <section className="rounded-xl border bg-card p-4 shadow-card sm:p-5">
        <div className="grid grid-cols-2 gap-3 sm:flex sm:flex-wrap sm:items-end">
          <Field
            label={T.groupBy}
            value={config.group_by}
            options={GROUP_BYS.map((value) => ({ value, label: T.groupBys[value] }))}
            onChange={(group_by) => set({ group_by })}
            className="sm:w-32"
          />
          <Field
            label={T.mode}
            value={config.mode}
            options={(["total", "monthly"] as const).map((value) => ({ value, label: T.modes[value] }))}
            onChange={(mode) =>
              set({ mode, chart: CHARTS[mode].includes(config.chart) ? config.chart : "bar" })
            }
            className="sm:w-28"
          />
          <Field
            label={T.range}
            value={config.range.preset}
            options={PRESETS.map((value) => ({ value, label: T.presets[value] }))}
            onChange={(preset) => set({ range: { preset, from_month: from, to_month: to } })}
            className="sm:w-32"
          />
          {config.range.preset === "custom" ? (
            <>
              <div className="space-y-1.5">
                <Label htmlFor={fromId} className="text-xs text-muted-foreground">
                  {T.from}
                </Label>
                <Input
                  id={fromId}
                  type="month"
                  value={from}
                  onChange={(event) =>
                    event.target.value ? set({ range: { preset: "custom", from_month: event.target.value, to_month: to } }) : undefined
                  }
                  className="num w-full bg-card sm:w-40"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={toId} className="text-xs text-muted-foreground">
                  {T.to}
                </Label>
                <Input
                  id={toId}
                  type="month"
                  value={to}
                  onChange={(event) =>
                    event.target.value ? set({ range: { preset: "custom", from_month: from, to_month: event.target.value } }) : undefined
                  }
                  className="num w-full bg-card sm:w-40"
                />
              </div>
            </>
          ) : null}
          <Field
            label={T.chart}
            value={config.chart}
            options={CHARTS[config.mode].map((value) => ({ value, label: T.charts[value] }))}
            onChange={(chart) => set({ chart })}
            className="sm:w-28"
          />
        </div>
        <div className="mt-4 border-t pt-4">
          <SavedReports config={config} selectedId={savedId} onSelect={onSelectSaved} />
        </div>
      </section>

      {report.isLoadingError ? (
        <ErrorState title={S.errors.loadFailedTitle} error={report.error} onRetry={() => void report.refetch()} />
      ) : !report.data ? (
        <Skeleton role="status" aria-label={S.common.loading} className="h-96 rounded-xl" />
      ) : (
        <section
          className={cn(
            "overflow-hidden rounded-xl border bg-card shadow-card transition-opacity",
            report.isPlaceholderData && "opacity-60",
          )}
        >
          {report.data.groups.length === 0 ? (
            <p className="px-5 py-16 text-center text-muted-foreground">{T.empty}</p>
          ) : (
            <>
              <div className="p-4 sm:p-5">
                <ReportChart report={report.data} config={config} />
                {report.data.overlapping ? (
                  <p className="mt-3 rounded-md bg-warning-soft px-3 py-2 text-xs text-warning-foreground">{T.overlapping}</p>
                ) : null}
              </div>
              <ReportTable report={report.data} config={config} />
            </>
          )}
        </section>
      )}
    </div>
  );
}
