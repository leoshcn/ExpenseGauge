import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";

import { errorMessage, type Schemas } from "@/api/client";
import { createSchedule, keys, updateSchedule } from "@/api/queries";
import { FormError, FormField } from "@/components/form-field";
import { LeafCategorySelect } from "@/components/leaf-category-select";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useRestoreFocus } from "@/hooks/use-restore-focus";
import { S } from "@/strings.zh";

import { scheduleBody, scheduleChanges, type ScheduleForm, type ScheduleFormErrors, scheduleForm } from "./model";

const T = S.settings.schedules;
const D = T.dialog;
const DAYS = Array.from({ length: 31 }, (_, index) => index + 1);
const MONTHS = Array.from({ length: 12 }, (_, index) => index + 1);

/** A labelled native-feeling select of a few fixed options. */
function Choice({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: readonly { value: string; label: string }[];
  onChange: (value: string) => void;
}) {
  const id = useId();
  return (
    <div className="min-w-0 space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger id={id} className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent position="popper" className="max-h-72">
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

/**
 * Adds or edits a scheduled expense. Mounted only while open, keyed by what it edits.
 * Editing sends only what changed and closes without a request when nothing did.
 */
export function ScheduleDialog({
  schedule,
  tree,
  month,
  onClose,
}: {
  schedule?: Schemas["ScheduleOut"];
  tree: Schemas["CategoryTree"];
  /** The current month: where a new schedule starts by default. */
  month: string;
  onClose: () => void;
}) {
  useRestoreFocus();
  const queryClient = useQueryClient();
  const categoryId = useId();
  const startId = useId();
  const [form, setForm] = useState<ScheduleForm>(() => scheduleForm(month, schedule));
  const [errors, setErrors] = useState<ScheduleFormErrors>({});
  const set = (patch: Partial<ScheduleForm>) => setForm((current) => ({ ...current, ...patch }));
  const save = useMutation({
    mutationFn: (body: Schemas["ScheduleCreateIn"]) => {
      if (!schedule) return createSchedule(body);
      const changes = scheduleChanges(schedule, body);
      return changes ? updateSchedule(schedule.id, changes) : Promise.resolve(schedule);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: keys.schedules });
      onClose();
    },
  });

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const result = scheduleBody(form);
    setErrors(result.valid ? {} : result.errors);
    if (result.valid) save.mutate(result.body);
  }

  return (
    <Dialog open onOpenChange={(open) => (!open && !save.isPending ? onClose() : undefined)}>
      <DialogContent closeLabel={S.common.close} className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{schedule ? D.editTitle : D.addTitle}</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} noValidate className="grid gap-4">
          <FormField
            label={D.name}
            value={form.name}
            onChange={(event) => set({ name: event.target.value })}
            placeholder={D.namePlaceholder}
            error={errors.name ? S.common.nameRequired : undefined}
            maxLength={100}
            autoFocus
          />
          <FormField
            label={D.keyword}
            hint={D.keywordHint}
            value={form.keyword}
            onChange={(event) => set({ keyword: event.target.value })}
            error={errors.keyword ? D.keywordRequired : undefined}
            maxLength={100}
          />
          <div className="space-y-1.5">
            <Label htmlFor={categoryId}>{D.category}</Label>
            <LeafCategorySelect
              id={categoryId}
              tree={tree}
              value={form.categoryId}
              onChange={(next) => set({ categoryId: next })}
              placeholder={D.chooseCategory}
              invalid={errors.category}
            />
            {errors.category ? <p className="text-xs text-over">{D.categoryRequired}</p> : null}
          </div>
          <div className="space-y-2">
            <FormField
              label={D.amount}
              value={form.amount}
              onChange={(event) => set({ amount: event.target.value })}
              error={errors.amount ? D.amountInvalid : undefined}
              inputMode="decimal"
              autoComplete="off"
              className="num text-right"
            />
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.approximate}
                onChange={(event) => set({ approximate: event.target.checked })}
                className="accent-primary"
              />
              {D.approximate}
            </label>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Choice
              label={D.frequency}
              value={form.frequency}
              options={(["month", "year"] as const).map((value) => ({ value, label: D.frequencies[value] }))}
              onChange={(value) => set({ frequency: value === "year" ? "year" : "month" })}
            />
            {form.frequency === "year" ? (
              <Choice
                label={D.monthOfYear}
                value={String(form.monthOfYear)}
                options={MONTHS.map((value) => ({ value: String(value), label: D.monthOption(value) }))}
                onChange={(value) => set({ monthOfYear: Number(value) })}
              />
            ) : null}
            <Choice
              label={D.day}
              value={String(form.day)}
              options={[
                ...DAYS.map((value) => ({ value: String(value), label: D.dayOption(value) })),
                { value: "-1", label: D.lastDay },
              ]}
              onChange={(value) => set({ day: Number(value) })}
            />
            <div className="min-w-0 space-y-1.5">
              <Label htmlFor={startId}>{D.startMonth}</Label>
              <Input
                id={startId}
                type="month"
                value={form.startMonth}
                onChange={(event) => (event.target.value ? set({ startMonth: event.target.value }) : undefined)}
                className="num"
              />
            </div>
          </div>
          {schedule ? (
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.active}
                onChange={(event) => set({ active: event.target.checked })}
                className="accent-primary"
              />
              {D.active}
            </label>
          ) : null}
          <FormError message={save.isError ? errorMessage(save.error) : null} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={save.isPending}>
              {S.common.cancel}
            </Button>
            <Button type="submit" disabled={save.isPending}>
              {save.isPending ? D.saving : D.save}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
