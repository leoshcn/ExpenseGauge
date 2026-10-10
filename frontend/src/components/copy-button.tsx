import { CheckIcon, CopyIcon } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { copyText } from "@/lib/clipboard";
import { S } from "@/strings.zh";

type Result = "idle" | "copied" | "failed";

/** Copies `value`; confirms with a check mark (and says so to screen readers) for 2 s. */
export function CopyButton({
  value,
  label,
  showText = false,
  variant = "outline",
  className,
}: {
  value: string;
  /** What is copied, for the accessible name: "复制MCP 地址". */
  label: string;
  showText?: boolean;
  variant?: "outline" | "ghost" | "default";
  className?: string;
}) {
  const [result, setResult] = useState<Result>("idle");

  useEffect(() => {
    if (result === "idle") return;
    const timer = setTimeout(() => setResult("idle"), 2000);
    return () => clearTimeout(timer);
  }, [result]);

  const text = result === "copied" ? S.common.copied : result === "failed" ? S.common.copyFailed : null;

  return (
    <>
      <Button
        type="button"
        variant={variant}
        size={showText ? "sm" : "icon-sm"}
        className={className}
        aria-label={showText ? undefined : S.common.copyLabel(label)}
        title={showText ? undefined : S.common.copyLabel(label)}
        onClick={() => void copyText(value).then((ok) => setResult(ok ? "copied" : "failed"))}
      >
        {result === "copied" ? <CheckIcon className="text-positive" /> : <CopyIcon />}
        {showText ? (result === "copied" ? S.common.copied : S.common.copy) : null}
      </Button>
      <span role="status" className="sr-only">
        {text}
      </span>
      {result === "failed" ? <span className="text-xs text-over">{S.common.copyFailed}</span> : null}
    </>
  );
}
