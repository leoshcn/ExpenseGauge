import { cn } from "cn";

import { type Usage, usagePercent } from "@/lib/budget";

const FILL: Record<Usage["state"], string> = {
  none: "",
  ok: "bg-primary",
  near: "bg-warning",
  over: "bg-over",
};

/**
 * The budget bar used everywhere a budget is compared with spending.
 * - within budget: the bar fills in proportion, teal, turning amber near the limit;
 * - over budget: the whole bar is vermilion and a notch marks where the budget ended,
 *   so the length to the right of the notch is the overspend;
 * - no budget: an empty dashed outline, visibly "not measured" rather than "0%".
 * `marker` (0..1) draws a tick, used for "today" on the month's total.
 */
export function BudgetMeter({
  usage,
  label,
  marker,
  markerLabel,
  size = "sm",
  className,
}: {
  usage: Usage;
  label: string;
  marker?: number | null;
  markerLabel?: string;
  size?: "sm" | "md";
  className?: string;
}) {
  const height = size === "md" ? "h-2.5" : "h-1.5";

  if (usage.state === "none") {
    return (
      <div
        aria-hidden="true"
        className={cn("rounded-full border border-dashed border-input", height, className)}
      />
    );
  }

  const ratio = usage.ratio;
  const over = usage.state === "over";
  const fill = over ? 1 : Math.min(Math.max(ratio ?? 0, 0), 1);
  // Where the budget ends inside an over-budget bar. Absent for a zero budget.
  const notch = over && ratio !== null && ratio > 1 ? 1 / ratio : null;

  return (
    <div
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(Math.min(Math.max(ratio ?? (over ? 1 : 0), 0), 1) * 100)}
      aria-valuetext={usagePercent(usage) ?? undefined}
      className={cn("relative", className)}
    >
      <div className={cn("overflow-hidden rounded-full bg-track", height)}>
        <div
          className={cn("h-full rounded-full transition-[width] duration-300", FILL[usage.state])}
          style={{ width: `${fill * 100}%` }}
        />
      </div>
      {notch !== null ? (
        <span
          aria-hidden="true"
          className={cn("absolute top-0 w-0.5 -translate-x-1/2 bg-card", height)}
          style={{ left: `${notch * 100}%` }}
        />
      ) : null}
      {marker != null ? (
        <span
          aria-hidden="true"
          title={markerLabel}
          className="absolute -top-1 -bottom-1 w-px -translate-x-1/2 bg-foreground/70"
          style={{ left: `${Math.min(Math.max(marker, 0), 1) * 100}%` }}
        />
      ) : null}
    </div>
  );
}
