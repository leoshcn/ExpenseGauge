import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { cn } from "cn";
import { CalendarClockIcon, PencilIcon, PlusIcon, SparklesIcon, Trash2Icon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { errorMessage, type Schemas } from "@/api/client";
import {
  categoriesQuery,
  createSchedule,
  deleteSchedule,
  keys,
  schedulesQuery,
  scheduleSuggestionsQuery,
} from "@/api/queries";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { EmptyState } from "@/components/empty-state";
import { ErrorState } from "@/components/error-state";
import { ScheduleWhen } from "@/components/schedule-when";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { formatMonth } from "@/lib/date";
import { formatMoney } from "@/lib/money";
import { monthOf } from "@/lib/month";
import { S } from "@/strings.zh";

import { ScheduleDialog } from "./schedule-dialog";
import { SectionCard } from "./section-card";

const T = S.settings.schedules;


function ScheduleRow({
  schedule,
  currency,
  onEdit,
  onDelete,
}: {
  schedule: Schemas["ScheduleOut"];
  currency: string;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <li className={cn("flex items-center gap-3 border-t px-4 py-3 sm:px-5", !schedule.active && "opacity-60")}>
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-x-2 font-medium">
          {schedule.name}
          {!schedule.active ? (
            <span className="rounded-full border px-1.5 text-[11px] leading-[1.125rem] font-normal text-muted-foreground">
              {T.paused}
            </span>
          ) : null}
        </p>
        <p className="num text-xs text-muted-foreground">
          <ScheduleWhen schedule={schedule} /> · {schedule.parent_category_name} / {schedule.category_name} ·{" "}
          {T.keywordOf(schedule.keyword)} · {T.since(formatMonth(schedule.start_month))}
        </p>
      </div>
      <span className="num amount shrink-0 font-medium">
        {schedule.approximate ? T.approx : ""}
        {formatMoney(schedule.amount, currency)}
      </span>
      <div className="flex shrink-0">
        <Button variant="ghost" size="icon-sm" aria-label={T.edit(schedule.name)} title={T.edit(schedule.name)} onClick={onEdit}>
          <PencilIcon />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={T.delete(schedule.name)}
          title={T.delete(schedule.name)}
          className="hover:text-over"
          onClick={onDelete}
        >
          <Trash2Icon />
        </Button>
      </div>
    </li>
  );
}

/** Recurring payments found in the history, each added with one click. */
function Suggestions({ currency, month }: { currency: string; month: string }) {
  const queryClient = useQueryClient();
  const suggestions = useQuery(scheduleSuggestionsQuery);
  const add = useMutation({
    mutationFn: (suggestion: Schemas["ScheduleSuggestion"]) =>
      createSchedule({
        name: suggestion.name,
        keyword: suggestion.keyword,
        category_id: suggestion.category_id,
        amount: suggestion.amount,
        approximate: suggestion.approximate,
        frequency: "month",
        day: suggestion.day,
        start_month: month,
        active: true,
      }),
    onSuccess: async (created) => {
      toast.success(T.suggestions.added(created.name));
      await queryClient.invalidateQueries({ queryKey: keys.schedules });
    },
  });
  return (
    <SectionCard title={T.suggestions.title} description={T.suggestions.description}>
      {suggestions.isLoadingError ? (
        <div className="px-4 pb-4 sm:px-5">
          <ErrorState title={S.errors.loadFailedTitle} error={suggestions.error} onRetry={() => void suggestions.refetch()} />
        </div>
      ) : !suggestions.data ? (
        <Skeleton role="status" aria-label={S.common.loading} className="mx-5 mb-5 h-16" />
      ) : suggestions.data.length === 0 ? (
        <p className="border-t px-4 py-4 text-sm text-muted-foreground sm:px-5">{T.suggestions.empty}</p>
      ) : (
        <ul>
          {suggestions.data.map((suggestion) => (
            <li key={suggestion.keyword} className="flex items-center gap-3 border-t px-4 py-3 sm:px-5">
              <SparklesIcon className="size-4 shrink-0 text-primary" aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <p className="font-medium">{suggestion.name}</p>
                <p className="num text-xs text-muted-foreground">
                  {T.suggestions.summary(T.day(suggestion.day), suggestion.months)} · {suggestion.category_name}
                </p>
              </div>
              <span className="num amount shrink-0 font-medium">
                {suggestion.approximate ? T.approx : ""}
                {formatMoney(suggestion.amount, currency)}
              </span>
              <Button
                size="sm"
                variant="outline"
                disabled={add.isPending}
                onClick={() => add.mutate(suggestion)}
                aria-label={T.suggestions.add(suggestion.name)}
              >
                <PlusIcon />
              </Button>
            </li>
          ))}
        </ul>
      )}
      {add.isError ? <p role="alert" className="px-5 pb-4 text-sm text-over">{errorMessage(add.error)}</p> : null}
    </SectionCard>
  );
}

type Dialog = { kind: "add" } | { kind: "edit" | "delete"; schedule: Schemas["ScheduleOut"] } | null;

/** Settings → 定期支出: the list, add/edit/delete, and suggestions from the history. */
export function SchedulesSection({ currency }: { currency: string }) {
  const [month] = useState(() => monthOf(new Date()));
  const queryClient = useQueryClient();
  const schedules = useQuery(schedulesQuery);
  const tree = useQuery(categoriesQuery());
  const [dialog, setDialog] = useState<Dialog>(null);
  const remove = useMutation({
    mutationFn: (id: number) => deleteSchedule(id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: keys.schedules });
      setDialog(null);
    },
  });

  let body: React.ReactNode;
  if (schedules.isLoadingError || tree.isLoadingError) {
    body = (
      <div className="px-4 pb-4 sm:px-5">
        <ErrorState
          title={S.errors.loadFailedTitle}
          error={schedules.error ?? tree.error}
          onRetry={() => {
            void schedules.refetch();
            void tree.refetch();
          }}
        />
      </div>
    );
  } else if (!schedules.data || !tree.data) {
    body = <Skeleton role="status" aria-label={S.common.loading} className="mx-5 mb-5 h-24" />;
  } else if (schedules.data.length === 0) {
    body = (
      <div className="px-4 pb-5 sm:px-5">
        <EmptyState icon={CalendarClockIcon} title={T.empty} body={T.emptyBody} />
      </div>
    );
  } else {
    body = (
      <ul>
        {schedules.data.map((schedule) => (
          <ScheduleRow
            key={schedule.id}
            schedule={schedule}
            currency={currency}
            onEdit={() => setDialog({ kind: "edit", schedule })}
            onDelete={() => setDialog({ kind: "delete", schedule })}
          />
        ))}
      </ul>
    );
  }

  return (
    <div className="space-y-5">
      <SectionCard
        title={T.title}
        description={T.description}
        action={
          <Button size="sm" onClick={() => setDialog({ kind: "add" })} disabled={!tree.data}>
            <PlusIcon />
            {T.add}
          </Button>
        }
      >
        {body}
      </SectionCard>
      <Suggestions currency={currency} month={month} />
      {dialog?.kind === "add" && tree.data ? (
        <ScheduleDialog tree={tree.data} month={month} onClose={() => setDialog(null)} />
      ) : null}
      {dialog?.kind === "edit" && tree.data ? (
        <ScheduleDialog
          key={dialog.schedule.id}
          schedule={dialog.schedule}
          tree={tree.data}
          month={month}
          onClose={() => setDialog(null)}
        />
      ) : null}
      {dialog?.kind === "delete" ? (
        <ConfirmDialog
          open
          onOpenChange={(open) => (open ? undefined : setDialog(null))}
          title={T.deleteTitle(dialog.schedule.name)}
          description={T.deleteBody}
          confirmLabel={T.deleteConfirm}
          pendingLabel={T.deleting}
          pending={remove.isPending}
          error={remove.isError ? errorMessage(remove.error) : null}
          onConfirm={() => remove.mutate(dialog.schedule.id)}
        />
      ) : null}
    </div>
  );
}
