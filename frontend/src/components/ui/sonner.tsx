import { Toaster as Sonner, type ToasterProps } from "sonner"

import { useTheme } from "@/hooks/use-theme"

/** Sonner themed with the design tokens; the theme follows the app's, not the system's. */
function Toaster(props: ToasterProps) {
  const { theme } = useTheme()
  return (
    <Sonner
      theme={theme}
      className="toaster group"
      toastOptions={{
        classNames: {
          actionButton: "!bg-primary !text-primary-foreground",
        },
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--border-radius": "var(--radius)",
        } as React.CSSProperties
      }
      {...props}
    />
  )
}

export { Toaster }
