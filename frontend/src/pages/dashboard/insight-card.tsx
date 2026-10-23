import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { cn } from "cn";
import {
  CircleCheckIcon,
  InfoIcon,
  LoaderCircleIcon,
  type LucideIcon,
  RefreshCwIcon,
  SparklesIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { Link } from "react-router";

import { errorMessage, type Schemas } from "@/api/client";
import { generateInsight, insightQuery, keys } from "@/api/queries";
import { ErrorState } from "@/components/error-state";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDateTime } from "@/lib/date";
import { parseMonth } from "@/lib/month";
import { S } from "@/strings.zh";

const T = S.dashboard.insight;

type Tone = Schemas["InsightPoint"]["tone"];

const TONE: Record<Tone, { icon: LucideIcon; className: string }> = {
  warning: { icon: TriangleAlertIcon, className: "text-warning-foreground" },
  positive: { icon: CircleCheckIcon, className: "text-positive" },
  neutral: { icon: InfoIcon, className: "text-muted-foreground" },
};

function Lines({ lines }: { lines: readonly Schemas["InsightPoint"][] }) {
  return (
    <ul className="space-y-1.5">
      {lines.map((line, index) => {
        const { icon: Icon, className } = TONE[line.tone];
        return (
          <li key={index} className="flex gap-2 leading-6">
            <Icon className={cn("mt-1 size-4 shrink-0", className)} aria-hidden="true" />
            <span>
              {/* The tone is not told by colour alone. */}
              <span className="sr-only">{T.tones[line.tone]}：</span>
              {line.text}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * The AI insight of the selected month in "全部": one or two short sentences, with the
 * model and time at the bottom and regenerating as an icon beside the title. Only the
 * user's click asks the model; opening the Dashboard reads the cached result. Its own
 * loading and failures never hold back the rest of the page.
 */
export function InsightCard({ month, className }: { month: string; className?: string }) {
  const queryClient = useQueryClient();
  const state = useQuery(insightQuery(month));
  const generate = useMutation({
    mutationFn: generateInsight,
    onSuccess: (next, generated) => queryClient.setQueryData(keys.insight(generated), next),
  });
  const generating = generate.isPending && generate.variables === month;
  const failed = generate.isError && generate.variables === month;
  const { year, month: number } = parseMonth(month);

  const data = state.data;
  const insight = data?.insight ?? null;
  const canGenerate = data?.configured === true;

  let body: React.ReactNode;
  if (state.isLoadingError) {
    body = (
      <ErrorState
        className="border-0 p-0 shadow-none"
        title={S.errors.loadFailedTitle}
        error={state.error}
        onRetry={() => void state.refetch()}
      />
    );
  } else if (!data) {
    body = (
      <div role="status" aria-label={S.common.loading} className="space-y-2">
        <Skeleton className="h-4" />
        <Skeleton className="h-4 w-2/3" />
      </div>
    );
  } else if (insight) {
    body = <Lines lines={insight.lines} />;
  } else if (!data.configured) {
    body = (
      <p className="text-[13px] leading-5 text-muted-foreground">
        {T.notConfigured}{" "}
        <Link to="/settings?tab=ai" className="font-medium text-primary underline-offset-4 hover:underline">
          {T.configure}
        </Link>
      </p>
    );
  } else {
    body = <p className="text-[13px] leading-5 text-muted-foreground">{T.empty}</p>;
  }

  return (
    <section
      className={cn("flex flex-col gap-3 rounded-xl border bg-card p-4 shadow-card sm:px-5", className)}
      aria-busy={generating}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <h2 className="flex items-center gap-1.5 text-base font-semibold">
            <SparklesIcon className="size-4 text-primary" aria-hidden="true" />
            {T.title}
          </h2>
          {/* Once there is an insight, regenerating is an icon beside the title. */}
          {canGenerate && insight ? (
            <Button
              size="icon-xs"
              variant="ghost"
              className="text-muted-foreground"
              disabled={generate.isPending}
              onClick={() => generate.mutate(month)}
              aria-label={generating ? T.generating : T.regenerate}
              title={generating ? T.generating : T.regenerate}
            >
              {generating ? (
                <LoaderCircleIcon className="animate-spin" aria-hidden="true" />
              ) : (
                <RefreshCwIcon aria-hidden="true" />
              )}
            </Button>
          ) : null}
          <p className="num truncate text-xs text-muted-foreground">{T.description(year, number)}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {data?.stale && insight ? (
            <span className="rounded-full bg-warning-soft px-2 text-xs leading-5 font-medium text-warning-foreground">
              {T.stale}
            </span>
          ) : null}
          {canGenerate && !insight ? (
            <Button size="sm" variant="outline" disabled={generate.isPending} onClick={() => generate.mutate(month)}>
              {generating ? (
                <LoaderCircleIcon className="animate-spin" aria-hidden="true" />
              ) : (
                <SparklesIcon aria-hidden="true" />
              )}
              {generating ? T.generating : T.generate}
            </Button>
          ) : null}
        </div>
      </div>
      {generating ? (
        <p role="status" className="text-xs text-muted-foreground">
          {T.generatingHint}
        </p>
      ) : null}
      {failed ? (
        <p role="alert" className="rounded-md bg-over-soft px-3 py-2 text-over">
          {T.failed(errorMessage(generate.error))}
        </p>
      ) : null}
      {body}
      {insight ? (
        <p className="num mt-auto text-xs text-muted-foreground">
          {T.meta(insight.model, formatDateTime(insight.generated_at))}
        </p>
      ) : null}
    </section>
  );
}
