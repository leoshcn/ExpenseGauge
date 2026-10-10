# Component Guidelines

> How components are built in this project.

---

## Overview

Function components with named exports, styled with Tailwind utilities that resolve to the
design tokens in `src/index.css`. `frontend/DESIGN.md` says what each token and pattern
means; read it before changing anything visible. Copy never appears in a component: it
comes from `src/strings.zh.ts`.

---

## Component Structure

Order within a file: imports (packages, then `@/`, then `./`), module constants, small
private components, then the exported component with a doc comment that says what it is
for, not what it is.

```tsx
// src/components/error-state.tsx
/** A failed load: what went wrong (the backend's own message), its code, and a way to retry. */
export function ErrorState({ title, error, onRetry, className }: { ... }) { ... }
```

A file exports components only. Helpers and constants shared with other files live in
`src/lib/` or a `model.ts` (eslint's `react-refresh/only-export-components` enforces this;
`src/components/ui/` is exempt).

---

## Props Conventions

- Props are typed inline in the parameter list; a named type is declared only when it is
  reused.
- Components that render data take the API's own types
  (`detail: Schemas["MonthDetailOut"]`), not a re-shaped copy.
- Layout-level components accept `className` and merge it with `cn` (imported from the
  `cn` package, as the vendored shadcn/ui components do) so the parent controls placement.
- Presentational components take data and callbacks; fetching happens in the page
  (`pages/dashboard/index.tsx` fetches, `category-table.tsx` renders).
- Time is passed in (`now: Date`), not read inside, so rendering is deterministic.

---

## Styling Patterns

- **Tokens only.** Use `bg-card`, `text-muted-foreground`, `text-over`, `bg-chart-budget`
  and so on. No hex or `oklch()` values and no Tailwind palette colours (`red-500`) in
  components. A new colour is a new variable in `:root` and `.dark` plus a line in
  `@theme inline`, and an entry in `DESIGN.md`.
- **Dark mode comes from the variables.** `dark:` variants are needed only in the vendored
  `ui/` components.
- **Numbers get the `num` utility** (tabular figures): every amount, percentage and date.
- **Budget states are drawn by `BudgetMeter`** and computed by `usage()` in
  `src/lib/budget.ts`. Do not re-implement thresholds or colours for a budget anywhere else.
- **Cards** are `rounded-xl border bg-card shadow-card` with `p-5`.
- **Responsive**: mobile first; `md` is where tables unfold, `lg` is where the sidebar and
  the multi-column grid appear. Check 360 to 390 px for every change.
- **Charts** go through `ChartContainer`, `ChartTooltip` and `ChartTooltipContent` from
  `src/components/ui/chart.tsx`; colours come from a `ChartConfig` that points at token
  variables (`color: "var(--chart-actual)"`). Chart animation is off
  (`isAnimationActive={false}`).

---

## Accessibility

- Every icon-only button has an `aria-label` from `strings.zh.ts`.
- Form inputs go through `FormField` (`src/components/form-field.tsx`), which wires the
  label, hint and error (`aria-invalid`, `aria-describedby`).
- Expandable rows are real buttons with `aria-expanded`.
- State is never shown by colour alone: over budget has a badge, text and a distinct meter.
- Charts have `role="img"` and a label, and everything a chart shows is also available as
  text beside it (the category table, the share list). Month selection works without the
  chart, through the previous/next buttons.
- Failures render with `role="alert"`; loading placeholders with `role="status"`.

---

## Common Mistakes

- **Using the chart's `onClick` to learn which month was clicked.** Recharts reports the
  month of the last hover, which on a tap is the previously touched month. `MonthColumns`
  in `pages/dashboard/trend-chart.tsx` draws one click target per month instead, and bars
  are `pointer-events-none` so clicks reach it.
- **`ReferenceArea` with the same category for `x1` and `x2`** did not render reliably for
  the last category; the selected-month band is drawn from `usePlotArea()` instead.
- **Recharts `Cell`** is deprecated in v3; colour individual bars with the `shape` prop and
  pie slices with a `fill` field in the data.
- **Screenshots with `fullPage: true`** place fixed bars in the middle of the image;
  `scripts/screenshots.mjs` grows the viewport instead.
- **Writing copy inline** ("加载中…" in JSX). Add it to `strings.zh.ts`.
- **Treating `budget: null` as zero.** It means "no budget" and has its own presentation.
