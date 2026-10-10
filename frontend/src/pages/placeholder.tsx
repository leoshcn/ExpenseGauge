import { ConstructionIcon } from "lucide-react";
import { Link } from "react-router";

import { Button } from "@/components/ui/button";
import { S } from "@/strings.zh";

/**
 * Stands in for the transactions, budgets and settings pages (parent implement.md
 * step 9b), which are built only after the Dashboard's visual design is approved.
 */
export function PlaceholderPage({ title, purpose }: { title: string; purpose: string }) {
  return (
    <div className="space-y-6">
      <h1 className="text-lg font-semibold tracking-tight">{title}</h1>
      <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed bg-card px-6 py-16 text-center">
        <span className="flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <ConstructionIcon className="size-5" />
        </span>
        <span className="rounded-full border px-2 py-0.5 text-xs text-muted-foreground">
          {S.placeholder.badge}
        </span>
        <p className="max-w-sm font-medium">{S.placeholder.body}</p>
        <p className="max-w-sm text-muted-foreground">{purpose}</p>
        <Button asChild variant="outline" size="sm" className="mt-2">
          <Link to="/dashboard">{S.placeholder.backToDashboard}</Link>
        </Button>
      </div>
    </div>
  );
}
