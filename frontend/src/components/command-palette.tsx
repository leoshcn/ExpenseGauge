import { useQuery } from "@tanstack/react-query";
import { EyeIcon, KeyboardIcon, type LucideIcon, SunMoonIcon, TagIcon } from "lucide-react";
import { useNavigate } from "react-router";

import { categoriesQuery } from "@/api/queries";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { usePrivacy } from "@/hooks/use-privacy";
import { useRestoreFocus } from "@/hooks/use-restore-focus";
import { useTheme } from "@/hooks/use-theme";
import { S } from "@/strings.zh";

const T = S.palette;

export type PaletteLink = { to: string; label: string; icon: LucideIcon };

/**
 * Ctrl/⌘+K: jump to a page or to one category's transactions, or run an action. Lists come
 * from the cached queries; nothing here changes data.
 */
export function CommandPalette({
  pages,
  onClose,
  onShortcuts,
}: {
  pages: readonly PaletteLink[];
  onClose: () => void;
  onShortcuts: () => void;
}) {
  useRestoreFocus();
  const navigate = useNavigate();
  const tree = useQuery(categoriesQuery(null));
  const theme = useTheme();
  const privacy = usePrivacy();

  const run = (action: () => void) => {
    onClose();
    action();
  };

  return (
    <CommandDialog
      open
      onOpenChange={(open) => (open ? undefined : onClose())}
      title={T.title}
      description={T.description}
      closeLabel={S.common.close}
    >
      <CommandInput placeholder={T.placeholder} />
      <CommandList>
        <CommandEmpty>{T.empty}</CommandEmpty>
        <CommandGroup heading={T.groups.pages}>
          {pages.map((page) => (
            <CommandItem key={page.to} value={`page ${page.label}`} onSelect={() => run(() => navigate(page.to))}>
              <page.icon />
              {page.label}
            </CommandItem>
          ))}
        </CommandGroup>
        {tree.data ? (
          <CommandGroup heading={T.groups.categories}>
            {tree.data.categories.flatMap((parent) =>
              parent.children.map((child) => (
                <CommandItem
                  key={child.id}
                  value={`category ${child.id} ${parent.name} ${child.name}`}
                  onSelect={() => run(() => navigate(`/transactions?category=${child.id}`))}
                >
                  <TagIcon />
                  {T.category(parent.name, child.name)}
                </CommandItem>
              )),
            )}
          </CommandGroup>
        ) : null}
        <CommandGroup heading={T.groups.actions}>
          <CommandItem value={`action ${T.toggleTheme}`} onSelect={() => run(theme.toggle)}>
            <SunMoonIcon />
            {T.toggleTheme}
          </CommandItem>
          <CommandItem value={`action ${T.togglePrivacy}`} onSelect={() => run(privacy.toggle)}>
            <EyeIcon />
            {T.togglePrivacy}
          </CommandItem>
          <CommandItem value={`action ${T.shortcuts}`} onSelect={() => run(onShortcuts)}>
            <KeyboardIcon />
            {T.shortcuts}
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
