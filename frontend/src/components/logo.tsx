import { cn } from "cn";

import { S } from "@/strings.zh";

/** The gauge mark: a track with a partly filled arc, the same idea as the budget meters. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" fill="none" aria-hidden="true" className={cn("size-7", className)}>
      <rect width="32" height="32" rx="8" className="fill-primary" />
      <path
        d="M7.5 20a8.5 8.5 0 0 1 17 0"
        className="stroke-primary-foreground/35"
        strokeWidth="3"
        strokeLinecap="round"
      />
      <path
        d="M7.5 20a8.5 8.5 0 0 1 12.2-7.65"
        className="stroke-primary-foreground"
        strokeWidth="3"
        strokeLinecap="round"
      />
      <circle cx="16" cy="20" r="2" className="fill-primary-foreground" />
    </svg>
  );
}

export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn("flex items-center gap-2.5", className)}>
      <LogoMark />
      <span className="text-[15px] font-semibold tracking-tight">{S.app.name}</span>
    </span>
  );
}
