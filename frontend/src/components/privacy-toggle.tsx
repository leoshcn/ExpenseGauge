import { EyeIcon, EyeOffIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { usePrivacy } from "@/hooks/use-privacy";
import { S } from "@/strings.zh";

/** Turns privacy mode (blurred amounts) on and off; Shift+H does the same. */
export function PrivacyToggle({ className }: { className?: string }) {
  const { hidden, toggle } = usePrivacy();
  const label = hidden ? S.privacy.show : S.privacy.hide;
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      className={className}
      onClick={toggle}
      aria-label={label}
      aria-pressed={hidden}
      title={`${label} (Shift+H)`}
    >
      {hidden ? <EyeOffIcon /> : <EyeIcon />}
    </Button>
  );
}
