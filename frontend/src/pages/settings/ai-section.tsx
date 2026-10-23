import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ShieldAlertIcon } from "lucide-react";
import { useId, useState } from "react";

import { errorMessage, type Schemas } from "@/api/client";
import { aiSettingsQuery, keys, testAiSettings, updateAiSettings } from "@/api/queries";
import { ErrorState } from "@/components/error-state";
import { FormError, FormField } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { S } from "@/strings.zh";

import { type AiForm, aiSettingsBody, type AiFormErrors, validateAiForm } from "./model";
import { SectionCard } from "./section-card";

const T = S.settings.ai;

/** What leaves the server when an insight is generated. */
function PrivacyNotice() {
  return (
    <div className="flex gap-3 rounded-lg bg-warning-soft p-3 text-warning-foreground">
      <ShieldAlertIcon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <div className="space-y-0.5">
        <p className="font-medium">{T.privacyTitle}</p>
        <p className="text-[13px] leading-5">{T.privacy}</p>
      </div>
    </div>
  );
}

/** The API key: write-only. Shows whether one is stored, never the key itself. */
function ApiKeyField({
  saved,
  value,
  clear,
  error,
  onChange,
  onClear,
}: {
  saved: Schemas["AiSettingsOut"];
  value: string;
  clear: boolean;
  error?: string;
  onChange: (value: string) => void;
  onClear: (clear: boolean) => void;
}) {
  const id = useId();
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{T.apiKey}</Label>
      <div className="flex gap-2">
        <Input
          id={id}
          type="password"
          autoComplete="off"
          spellCheck={false}
          value={value}
          disabled={clear}
          onChange={(event) => onChange(event.target.value)}
          placeholder={saved.api_key_set ? T.apiKeySetPlaceholder(saved.api_key_hint) : T.apiKeyPlaceholder}
          aria-describedby={`${id}-note`}
          aria-invalid={error ? true : undefined}
        />
        {saved.api_key_set ? (
          <Button
            type="button"
            variant="outline"
            onClick={() => onClear(!clear)}
            aria-label={clear ? undefined : T.clearKeyLabel}
          >
            {clear ? T.undoClear : T.clearKey}
          </Button>
        ) : null}
      </div>
      <p
        id={`${id}-note`}
        className={
          error ? "text-xs text-over" : clear ? "text-xs text-warning-foreground" : "text-xs text-muted-foreground"
        }
      >
        {error ?? (clear ? T.keyWillClear : T.apiKeyHint)}
      </p>
    </div>
  );
}

function AiSettingsForm({ saved }: { saved: Schemas["AiSettingsOut"] }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<AiForm>({
    baseUrl: saved.base_url ?? "",
    model: saved.model ?? "",
    apiKey: "",
    clearKey: false,
  });
  const [errors, setErrors] = useState<AiFormErrors>({});

  const test = useMutation({ mutationFn: testAiSettings });
  const save = useMutation({
    mutationFn: updateAiSettings,
    // The key typed in the form travels only in this request; drop it from the cache.
    gcTime: 0,
    onSuccess: (next) => {
      queryClient.setQueryData(keys.aiSettings, next);
      setForm((current) => ({ ...current, apiKey: "", clearKey: false }));
      test.reset();
      // The insight card shows whether a service is configured.
      return queryClient.invalidateQueries({ queryKey: keys.insights });
    },
  });

  function change(patch: Partial<AiForm>) {
    save.reset();
    setForm((current) => ({ ...current, ...patch }));
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const found = validateAiForm(form);
    setErrors(found);
    if (Object.keys(found).length === 0) save.mutate(aiSettingsBody(form));
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-4 border-t px-4 py-4 sm:px-5">
      <div className="grid gap-4 md:grid-cols-2">
        <FormField
          label={T.baseUrl}
          value={form.baseUrl}
          onChange={(event) => change({ baseUrl: event.target.value })}
          placeholder={T.baseUrlPlaceholder}
          hint={T.baseUrlHint}
          error={
            errors.baseUrl === "required" ? T.baseUrlRequired : errors.baseUrl === "invalid" ? T.baseUrlInvalid : undefined
          }
          inputMode="url"
          autoComplete="off"
          spellCheck={false}
          maxLength={500}
        />
        <FormField
          label={T.model}
          value={form.model}
          onChange={(event) => change({ model: event.target.value })}
          placeholder={T.modelPlaceholder}
          error={errors.model ? T.modelRequired : undefined}
          autoComplete="off"
          spellCheck={false}
          maxLength={200}
        />
      </div>
      <div className="md:max-w-[calc(50%-0.5rem)]">
        <ApiKeyField
          saved={saved}
          value={form.apiKey}
          clear={form.clearKey}
          error={errors.apiKey ? T.apiKeyInvalid : undefined}
          onChange={(apiKey) => change({ apiKey })}
          onClear={(clearKey) => change({ clearKey, apiKey: "" })}
        />
      </div>
      <PrivacyNotice />
      <FormError message={save.isError ? errorMessage(save.error) : null} />
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" disabled={save.isPending}>
          {save.isPending ? T.saving : T.save}
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={!saved.configured || test.isPending}
          onClick={() => test.mutate()}
        >
          {test.isPending ? T.testing : T.test}
        </Button>
        {save.isSuccess ? (
          <span role="status" className="text-xs text-positive">
            {T.saved}
          </span>
        ) : null}
      </div>
      <p className="text-xs text-muted-foreground">{T.testHint}</p>
      {test.isSuccess ? (
        <p role="status" className="rounded-md bg-positive-soft px-3 py-2 text-positive">
          {T.testOk(test.data.model, (test.data.latency_ms / 1000).toFixed(1))}
        </p>
      ) : null}
      <FormError message={test.isError ? errorMessage(test.error) : null} />
    </form>
  );
}

/** The AI service behind the Dashboard's insight card: base URL, model and a write-only key. */
export function AiSection() {
  const settings = useQuery(aiSettingsQuery);

  let content: React.ReactNode;
  if (settings.isLoadingError) {
    content = (
      <ErrorState
        className="rounded-none border-0 border-t shadow-none"
        title={S.errors.loadFailedTitle}
        error={settings.error}
        onRetry={() => void settings.refetch()}
      />
    );
  } else if (!settings.data) {
    content = (
      <div role="status" aria-label={S.common.loading} className="space-y-3 border-t p-5">
        <Skeleton className="h-10" />
        <Skeleton className="h-10" />
      </div>
    );
  } else {
    content = <AiSettingsForm saved={settings.data} />;
  }

  return (
    <SectionCard title={T.title} description={T.description}>
      {content}
    </SectionCard>
  );
}
