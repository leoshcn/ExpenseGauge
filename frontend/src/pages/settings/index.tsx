import { useQuery } from "@tanstack/react-query";

import { budgetAccountsQuery, channelsQuery, settingsQuery } from "@/api/queries";
import { ErrorState } from "@/components/error-state";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useSearchState } from "@/hooks/use-search-state";
import { DEFAULT_CURRENCY } from "@/lib/currency";
import { S } from "@/strings.zh";

import { AgentSection } from "./agent-section";
import { AiSection } from "./ai-section";
import { CategoriesSection } from "./categories-section";
import { LedgerSection } from "./ledger-section";
import { SchedulesSection } from "./schedules-section";

const T = S.settings;
const TABS = ["ledger", "categories", "schedules", "agent", "ai"] as const;
type Tab = (typeof TABS)[number];

function isTab(value: string | null): value is Tab {
  return TABS.includes(value as Tab);
}

/**
 * The ledger (base currency, budget accounts, payment channels), the global category
 * tree, what an agent needs (tokens, endpoint, channel IDs) and the AI service behind the
 * Dashboard's insight card, one tab each. The tab
 * lives in the URL (`?tab=categories`), so other pages can link straight to it.
 */
export function SettingsPage() {
  const { params, update } = useSearchState();
  const requested = params.get("tab");
  const tab: Tab = isTab(requested) ? requested : "ledger";
  const settings = useQuery(settingsQuery);
  const budgetAccounts = useQuery(budgetAccountsQuery);
  const channels = useQuery(channelsQuery);

  const failed = [settings, budgetAccounts, channels].find((query) => query.isLoadingError);
  let content: React.ReactNode;
  if (failed) {
    content = (
      <ErrorState title={S.errors.loadFailedTitle} error={failed.error} onRetry={() => void failed.refetch()} />
    );
  } else if (!settings.data || !budgetAccounts.data || !channels.data) {
    content = <Skeleton role="status" aria-label={S.common.loading} className="h-96 rounded-xl" />;
  } else {
    content = (
      <>
        <TabsContent value="ledger">
          <LedgerSection settings={settings.data} budgetAccounts={budgetAccounts.data} channels={channels.data} />
        </TabsContent>
        <TabsContent value="categories">
          <CategoriesSection budgetAccounts={budgetAccounts.data} />
        </TabsContent>
        <TabsContent value="schedules">
          <SchedulesSection currency={settings.data.currency ?? DEFAULT_CURRENCY} />
        </TabsContent>
        <TabsContent value="agent">
          <AgentSection channels={channels.data} />
        </TabsContent>
        <TabsContent value="ai">
          <AiSection />
        </TabsContent>
      </>
    );
  }

  return (
    <Tabs value={tab} onValueChange={(next) => update({ tab: next === "ledger" ? null : next })} className="gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-lg font-semibold tracking-tight">{T.title}</h1>
        <TabsList aria-label={T.tabs.label} className="max-sm:w-full">
          <TabsTrigger value="ledger">{T.tabs.ledger}</TabsTrigger>
          <TabsTrigger value="categories">{T.tabs.categories}</TabsTrigger>
          <TabsTrigger value="schedules">{T.tabs.schedules}</TabsTrigger>
          <TabsTrigger value="agent">{T.tabs.agent}</TabsTrigger>
          <TabsTrigger value="ai">{T.tabs.ai}</TabsTrigger>
        </TabsList>
      </div>
      {content}
    </Tabs>
  );
}
