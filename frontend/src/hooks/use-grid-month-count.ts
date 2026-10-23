import { useMediaQuery } from "@/hooks/use-media-query";

/**
 * How many months the Dashboard's budget grid shows side by side: three from `xl` (with
 * the sidebar, narrower screens cannot fit nine amount columns), two from `md`, one below.
 * The month bar highlights the same months.
 */
export function useGridMonthCount(): number {
  const wide = useMediaQuery("(min-width: 80rem)");
  const medium = useMediaQuery("(min-width: 48rem)");
  return wide ? 3 : medium ? 2 : 1;
}
