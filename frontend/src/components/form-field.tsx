import { useId } from "react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/** A labelled text input with its hint and error wired up for assistive technology. */
export function FormField({
  label,
  hint,
  error,
  ...input
}: {
  label: string;
  hint?: string;
  error?: string;
} & Omit<React.ComponentProps<"input">, "id" | "aria-invalid" | "aria-describedby">) {
  const id = useId();
  const note = error ?? hint;
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={note ? `${id}-note` : undefined}
        {...input}
      />
      {note ? (
        <p id={`${id}-note`} className={error ? "text-xs text-over" : "text-xs text-muted-foreground"}>
          {note}
        </p>
      ) : null}
    </div>
  );
}

/** The backend's message for a failed submit, shown above the submit button. */
export function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p role="alert" className="rounded-md bg-over-soft px-3 py-2 text-over">
      {message}
    </p>
  );
}
