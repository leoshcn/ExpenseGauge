import { CircleAlertIcon } from "lucide-react";
import { cn } from "cn";

import { ApiError, errorMessage } from "@/api/client";
import { Button } from "@/components/ui/button";
import { S } from "@/strings.zh";

/** A failed load: what went wrong (the backend's own message), its code, and a way to retry. */
export function ErrorState({
  title,
  error,
  onRetry,
  className,
}: {
  title: string;
  error: unknown;
  onRetry?: () => void;
  className?: string;
}) {
  return (
    <div
      role="alert"
      className={cn(
        "flex flex-col items-center gap-3 rounded-xl border bg-card px-6 py-12 text-center shadow-card",
        className,
      )}
    >
      <span className="flex size-10 items-center justify-center rounded-full bg-over-soft text-over">
        <CircleAlertIcon className="size-5" />
      </span>
      <div className="space-y-1">
        <h2 className="text-base font-semibold">{title}</h2>
        <p className="text-muted-foreground">{errorMessage(error)}</p>
        {error instanceof ApiError ? (
          <p className="num text-xs text-muted-foreground/80">{S.errors.codeLabel(error.code)}</p>
        ) : null}
      </div>
      {onRetry ? (
        <Button variant="outline" size="sm" onClick={onRetry}>
          {S.common.retry}
        </Button>
      ) : null}
    </div>
  );
}
