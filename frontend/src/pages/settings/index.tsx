import { AccountSelect } from "@/components/account-select";
import { ErrorState } from "@/components/error-state";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useSelectedAccount } from "@/hooks/use-search-state";
import { S } from "@/strings.zh";

import { AccountsSection } from "./accounts-section";
import { AgentSection } from "./agent-section";
import { CategoriesSection } from "./categories-section";

const T = S.settings;
const TABS = ["accounts", "categories", "agent"] as const;
type Tab = (typeof TABS)[number];

function isTab(value: string | null): value is Tab {
  return TABS.includes(value as Tab);
}

/**
 * Accounts, categories per account, and what an agent needs (tokens, endpoint, account
 * IDs), one tab each. The tab and the categories' account live in the URL
 * (`?tab=categories&account=<id>`), so other pages can link straight to them.
 */
export function SettingsPage() {
  const { accounts, account, params, update } = useSelectedAccount();
  const requested = params.get("tab");
  const tab: Tab = isTab(requested) ? requested : "accounts";

  let content: React.ReactNode;
  if (accounts.isLoadingError) {
    content = (
      <ErrorState title={S.errors.loadFailedTitle} error={accounts.error} onRetry={() => void accounts.refetch()} />
    );
  } else if (!accounts.data || !account) {
    content = <Skeleton role="status" aria-label={S.common.loading} className="h-96 rounded-xl" />;
  } else {
    content = (
      <>
        <TabsContent value="accounts">
          <AccountsSection accounts={accounts.data} />
        </TabsContent>
        <TabsContent value="categories">
          <CategoriesSection
            key={account.id}
            account={account}
            accountPicker={
              <AccountSelect accounts={accounts.data} value={account.id} onChange={(id) => update({ account: id })} />
            }
          />
        </TabsContent>
        <TabsContent value="agent">
          <AgentSection accounts={accounts.data} />
        </TabsContent>
      </>
    );
  }

  return (
    <Tabs value={tab} onValueChange={(next) => update({ tab: next === "accounts" ? null : next })} className="gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-lg font-semibold tracking-tight">{T.title}</h1>
        <TabsList aria-label={T.tabs.label} className="max-sm:w-full">
          <TabsTrigger value="accounts">{T.tabs.accounts}</TabsTrigger>
          <TabsTrigger value="categories">{T.tabs.categories}</TabsTrigger>
          <TabsTrigger value="agent">{T.tabs.agent}</TabsTrigger>
        </TabsList>
      </div>
      {content}
    </Tabs>
  );
}
