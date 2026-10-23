import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useRestoreFocus } from "@/hooks/use-restore-focus";
import { modLabel } from "@/lib/platform";
import { S } from "@/strings.zh";

const T = S.shortcuts;

function Keys({ keys }: { keys: readonly string[] }) {
  return (
    <span className="flex shrink-0 gap-1">
      {keys.map((key) => (
        <kbd
          key={key}
          className="num inline-flex h-6 min-w-6 items-center justify-center rounded-md border bg-muted px-1.5 text-xs font-medium"
        >
          {key}
        </kbd>
      ))}
    </span>
  );
}

/** Every keyboard shortcut of the app, opened with "?" or from the command palette. */
export function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  useRestoreFocus();
  const mod = modLabel();
  const groups: { title: string; items: { label: string; keys: string[] }[] }[] = [
    {
      title: T.groups.general,
      items: [
        { label: T.items.palette, keys: [mod, "K"] },
        { label: T.items.privacy, keys: ["Shift", "H"] },
        { label: T.items.help, keys: ["?"] },
      ],
    },
    {
      title: T.groups.months,
      items: [
        { label: T.items.previousMonth, keys: ["←"] },
        { label: T.items.nextMonth, keys: ["→"] },
        { label: T.items.currentMonth, keys: ["0"] },
      ],
    },
    {
      title: T.groups.transactions,
      items: [
        { label: T.items.search, keys: ["/"] },
        { label: T.items.undo, keys: [mod, "Z"] },
      ],
    },
  ];
  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent closeLabel={S.common.close}>
        <DialogHeader>
          <DialogTitle>{T.title}</DialogTitle>
          <DialogDescription>{T.description}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {groups.map((group) => (
            <section key={group.title}>
              <h3 className="mb-1.5 text-xs font-medium text-muted-foreground">{group.title}</h3>
              <ul className="divide-y rounded-lg border">
                {group.items.map((item) => (
                  <li key={item.label} className="flex items-center justify-between gap-3 px-3 py-2">
                    <span>{item.label}</span>
                    <Keys keys={item.keys} />
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
