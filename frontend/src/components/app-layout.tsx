import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { cn } from "cn";
import {
  LayoutDashboardIcon,
  LogOutIcon,
  ReceiptTextIcon,
  SettingsIcon,
  TargetIcon,
  type LucideIcon,
} from "lucide-react";
import { NavLink, Outlet } from "react-router";

import { ApiError } from "@/api/client";
import { keys, logout, meQuery } from "@/api/queries";
import { Logo } from "@/components/logo";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { S } from "@/strings.zh";

type NavItem = { to: string; label: string; icon: LucideIcon };

const NAV: readonly NavItem[] = [
  { to: "/dashboard", label: S.nav.dashboard, icon: LayoutDashboardIcon },
  { to: "/transactions", label: S.nav.transactions, icon: ReceiptTextIcon },
  { to: "/budgets", label: S.nav.budgets, icon: TargetIcon },
  { to: "/settings", label: S.nav.settings, icon: SettingsIcon },
];

function useLogout() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      try {
        await logout();
      } catch (error) {
        // Already signed out (expired session) is the outcome the user asked for.
        if (!(error instanceof ApiError && error.status === 401)) throw error;
      }
    },
    onSuccess: () => {
      // `me` going null makes the route guard redirect to the login page; everything
      // else is dropped so the next session never sees this one's data.
      queryClient.setQueryData(keys.me, null);
      queryClient.removeQueries({
        predicate: (query) => query.queryKey[0] !== keys.me[0] && query.queryKey[0] !== keys.setupStatus[0],
      });
    },
  });
}

function Sidebar() {
  const me = useQuery(meQuery);
  const signOut = useLogout();
  return (
    <aside className="fixed inset-y-0 left-0 z-30 hidden w-56 flex-col border-r bg-card lg:flex">
      <div className="flex h-16 items-center px-5">
        <Logo />
      </div>
      <nav aria-label={S.nav.label} className="flex flex-1 flex-col gap-0.5 px-3 py-2">
        {NAV.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) =>
              cn(
                "flex h-9 items-center gap-3 rounded-md px-3 font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
                isActive && "bg-accent text-accent-foreground hover:bg-accent hover:text-accent-foreground",
              )
            }
          >
            <item.icon className="size-4" aria-hidden="true" />
            <span className="flex-1">{item.label}</span>
          </NavLink>
        ))}
      </nav>
      <div className="flex items-center gap-1 border-t px-3 py-3">
        <span
          className="min-w-0 flex-1 truncate px-2 text-muted-foreground"
          title={me.data ? S.nav.signedInAs(me.data.username) : undefined}
        >
          {me.data?.username}
        </span>
        <ThemeToggle />
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => signOut.mutate()}
          disabled={signOut.isPending}
          aria-label={S.nav.logout}
          title={S.nav.logout}
        >
          <LogOutIcon />
        </Button>
      </div>
    </aside>
  );
}

function MobileBars() {
  const signOut = useLogout();
  return (
    <>
      <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b bg-card/90 px-4 backdrop-blur lg:hidden">
        <Logo />
        <div className="flex items-center gap-1">
          <ThemeToggle />
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => signOut.mutate()}
            disabled={signOut.isPending}
            aria-label={S.nav.logout}
          >
            <LogOutIcon />
          </Button>
        </div>
      </header>
      <nav
        aria-label={S.nav.label}
        className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-4 border-t bg-card/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden"
      >
        {NAV.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) =>
              cn(
                "flex h-14 flex-col items-center justify-center gap-0.5 text-xs text-muted-foreground",
                isActive && "font-medium text-primary",
              )
            }
          >
            <item.icon className="size-5" aria-hidden="true" />
            {item.label}
          </NavLink>
        ))}
      </nav>
    </>
  );
}

/** Shell of the signed-in app: sidebar from `lg` up, top bar and tab bar below it. */
export function AppLayout() {
  return (
    <div className="min-h-dvh">
      <Sidebar />
      <MobileBars />
      <main className="pb-[calc(3.5rem+env(safe-area-inset-bottom))] lg:pb-0 lg:pl-56">
        <div className="mx-auto w-full max-w-[1200px] px-4 py-5 sm:px-6 lg:px-8 lg:py-8">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
