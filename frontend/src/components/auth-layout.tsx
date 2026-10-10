import { Logo } from "@/components/logo";
import { ThemeToggle } from "@/components/theme-toggle";
import { S } from "@/strings.zh";

/** Centered single-column shell for setup, login and onboarding. */
export function AuthLayout({
  title,
  description,
  eyebrow,
  children,
}: {
  title: string;
  description?: string;
  eyebrow?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex h-14 items-center justify-between px-4 sm:px-6">
        <Logo />
        <ThemeToggle />
      </header>
      <main className="flex flex-1 items-start justify-center px-4 pt-[8vh] pb-12">
        <div className="w-full max-w-[26rem]">
          <div className="mb-6 space-y-1.5">
            {eyebrow ? <div className="num text-xs text-muted-foreground">{eyebrow}</div> : null}
            <h1 className="text-lg font-semibold tracking-tight">{title}</h1>
            {description ? <p className="text-muted-foreground">{description}</p> : null}
          </div>
          <div className="rounded-xl border bg-card p-5 shadow-card sm:p-6">{children}</div>
          <p className="mt-6 text-center text-xs text-muted-foreground">{S.app.tagline}</p>
        </div>
      </main>
    </div>
  );
}
