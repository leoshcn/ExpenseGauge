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

function Points({ title, points }: { title: string; points: readonly Schemas["InsightPoint"][] }) {
  if (points.length === 0) return null;
  return (
    <div className="space-y-2">
      <h3 className="text-xs font-medium text-muted-foreground">{title}</h3>
      <ul className="space-y-2">
        {points.map((point, index) => {
          const { icon: Icon, className } = TONE[point.tone];
          return (
            <li key={index} className="flex gap-2.5 leading-6">
              <Icon className={cn("mt-1 size-4 shrink-0", className)} aria-hidden="true" />
              <span>
                {/* The tone is not told by colour alone. */}
                <span className="sr-only">{T.tones[point.tone]}：</span>
                {point.text}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * The AI insight of the selected month in "全部": a one-line summary and points about the
 * month and the year to date. Only the user's click asks the model; opening the Dashboard
 * reads the cached result. Its own loading and failures never hold back the rest of the page.
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
        className="rounded-none border-0 border-t shadow-none"
        title={S.errors.loadFailedTitle}
        error={state.error}
        onRetry={() => void state.refetch()}
      />
    );
  } else if (!data) {
    body = (
      <div role="status" aria-label={S.common.loading} className="space-y-2 border-t px-4 py-4 sm:px-5">
        <Skeleton className="h-5 w-2/3" />
        <Skeleton className="h-4" />
        <Skeleton className="h-4 w-5/6" />
      </div>
    );
  } else if (insight) {
    body = (
      <div className="space-y-4 border-t px-4 py-4 sm:px-5">
        <p className="text-[15px] leading-6 font-medium">{insight.summary}</p>
        <div className="grid gap-4 md:grid-cols-2 md:gap-6">
          <Points title={T.month} points={insight.month_points} />
          <Points title={T.year} points={insight.year_points} />
        </div>
        <p className="num text-xs text-muted-foreground">
          {T.meta(insight.model, formatDateTime(insight.generated_at))}
        </p>
      </div>
    );
  } else if (!data.configured) {
    body = (
      <div className="flex flex-col items-start gap-3 border-t px-4 py-4 sm:px-5">
        <div className="space-y-1">
          <p className="font-medium">{T.notConfigured}</p>
          <p className="max-w-2xl text-[13px] leading-5 text-muted-foreground">{T.notConfiguredBody}</p>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link to="/settings?tab=ai">{T.configure}</Link>
        </Button>
      </div>
    );
  } else {
    body = (
      <div className="space-y-1 border-t px-4 py-4 sm:px-5">
        <p className="font-medium">{T.empty}</p>
        <p className="max-w-2xl text-[13px] leading-5 text-muted-foreground">{T.emptyBody}</p>
      </div>
    );
  }

  return (
    <section className={cn("overflow-hidden rounded-xl border bg-card shadow-card", className)} aria-busy={generating}>
      <div className="flex flex-wrap items-start justify-between gap-3 px-4 py-4 sm:px-5">
        <div className="min-w-0 flex-1 basis-56">
          <h2 className="flex items-center gap-1.5 text-base font-semibold">
            <SparklesIcon className="size-4 text-primary" aria-hidden="true" />
            {T.title}
          </h2>
          <p className="num text-xs text-muted-foreground">{T.description(year, number)}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {data?.stale && insight ? (
            <span className="rounded-full bg-warning-soft px-2 text-xs leading-5 font-medium text-warning-foreground">
              {T.stale}
            </span>
          ) : null}
          {canGenerate ? (
            <Button
              size="sm"
              variant={insight ? "outline" : "default"}
              disabled={generate.isPending}
              onClick={() => generate.mutate(month)}
            >
              {generating ? (
                <LoaderCircleIcon className="animate-spin" aria-hidden="true" />
              ) : insight ? (
                <RefreshCwIcon aria-hidden="true" />
              ) : (
                <SparklesIcon aria-hidden="true" />
              )}
              {generating ? T.generating : insight ? T.regenerate : T.generate}
            </Button>
          ) : null}
        </div>
      </div>
      {generating ? (
        <p role="status" className="border-t bg-muted/40 px-4 py-2 text-xs text-muted-foreground sm:px-5">
          {T.generatingHint}
        </p>
      ) : null}
      {failed ? (
        <p role="alert" className="border-t bg-over-soft px-4 py-2 text-over sm:px-5">
          {T.failed(errorMessage(generate.error))}
        </p>
      ) : null}
      {body}
    </section>
  );
}
