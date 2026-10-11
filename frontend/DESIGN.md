# ExpenseGauge design spec

The source of truth for values is `src/index.css`; this file records what the values are
for and why. Change both together. Screenshots of the current state are in
`docs/screenshots/`.

## Principles

1. **The question on screen is "am I within budget?"** Colour is reserved for the answer.
   Neutral surfaces, one brand hue, and three state hues that mean the same thing everywhere.
2. **Numbers are the content.** Amounts are set in tabular figures, right-aligned, at full
   precision, in the ledger's base currency. Nothing is abbreviated except chart axis ticks.
3. **Over budget must be found without reading.** It is never signalled by colour alone:
   an over-budget row has a vermilion edge, a "超支" badge, the overspend amount in words,
   and a meter drawn differently from every other state.
4. **"No budget" is not "0%".** An unbudgeted category shows "未设预算" and no meter, so
   it cannot be mistaken for a category that is doing well.

## Colour tokens

All colours are CSS variables in OKLCH, defined for `:root` (light) and `.dark`, and mapped
to Tailwind utilities with `@theme inline` (`bg-card`, `text-over`, `bg-chart-budget` ...).
Components never use raw colour values.

| Token | Light | Dark | Use |
|---|---|---|---|
| `--background` | `oklch(0.982 0.004 90)` | `oklch(0.172 0.008 255)` | Page. Warm paper in light, cool ink in dark |
| `--card` | `oklch(1 0 0)` | `oklch(0.212 0.009 255)` | Cards, sidebar, bars |
| `--foreground` | `oklch(0.24 0.014 255)` | `oklch(0.935 0.005 90)` | Text and figures |
| `--muted-foreground` | `oklch(0.5 0.014 255)` | `oklch(0.69 0.012 255)` | Labels, secondary figures |
| `--muted` | `oklch(0.957 0.005 90)` | `oklch(0.255 0.01 255)` | Table head, level-2 rows, hover |
| `--border` / `--input` | `0.912` / `0.87` lightness | `0.29` / `0.35` | Hairlines / control outlines |
| `--primary` | `oklch(0.4 0.068 195)` | `oklch(0.76 0.085 192)` | Brand (黛青, a deep teal): primary buttons, "within budget" fill, actual bars |
| `--accent` | `oklch(0.945 0.014 195)` | `oklch(0.275 0.026 195)` | Selected navigation item, selected month band |
| `--warning` (+`-soft`, `-foreground`) | `oklch(0.7 0.14 70)` | `oklch(0.79 0.13 75)` | Near the budget: 85% to 100% |
| `--over` (+`-soft`) | `oklch(0.56 0.19 27)` | `oklch(0.69 0.17 27)` | Over budget; also form errors (`--destructive`) |
| `--positive` (+`-soft`) | `oklch(0.55 0.105 165)` | `oklch(0.74 0.11 165)` | "All within budget" chip, completed step |
| `--track` | `oklch(0.925 0.006 90)` | `oklch(0.285 0.01 255)` | Empty part of a meter |
| `--chart-annual` | `var(--chart-4)` | `var(--chart-4)` | Annual budget accounts' spending: the stacked segment in "全部", the running total in an annual view, the swatch before "另有年度开支" |

Rationale:

- **Warm neutral, not grey.** A hue of 90 at very low chroma keeps large light surfaces from
  looking clinical next to the teal; text is a cool near-black for contrast with it.
- **Teal as the brand and as "fine".** A within-budget meter is the brand colour, so the
  normal state of the page is calm and monochrome and the two warm state colours stand out.
- **Vermilion, not pure red**, at a chroma that holds on both themes. `-soft` variants are
  the same hue at very low chroma for badge and chip backgrounds.
- **Contrast.** Lightness gaps for body text and `--muted-foreground` on
  `--background`/`--card` were chosen to clear WCAG AA (4.5:1) in both themes; this has
  not been measured with a contrast tool yet. State text uses `--over` and `--warning-foreground`
  (darker than the `--warning` fill, which is too light for text on white).
- **Dark theme is designed, not inverted**: surfaces step up in lightness by elevation
  (page 0.17, card 0.21, popover 0.235) and coloured fills get lighter and slightly less
  saturated so they do not glow. Cards drop their shadow; the border carries the edge.

## Budget states

Defined once in `src/lib/budget.ts` (`usage()`), drawn once in
`src/components/budget-meter.tsx`.

| State | Rule | Meter | Text |
|---|---|---|---|
| `none` | budget is `null` | none (phone) / "仅统计实际支出" (desktop) | "未设预算", remaining "—" |
| `ok` | actual < 85% of budget | teal fill in proportion | remaining amount |
| `near` | 85% to 100% inclusive | amber fill | remaining amount |
| `over` | actual > budget (a budget of 0 counts) | full vermilion bar with a notch where the budget ended | "超支 ¥x", percentage in vermilion, badge, row edge |

The over-budget notch sits at `budget / actual`, so the part to its right is the overspend:
242% reads as "the budget, and then that much again and more". The month total's meter also
carries a thin "today" tick at the share of the month that has passed, so 93% used at 32%
of the month reads as a pace problem at a glance. It is shown for the current month only.

**Annual budget accounts** use the same states against the year to date, with the tick at
the year's time progress (`yearProgress()`: today's place in the year for the current
month, otherwise whole months / 12) on every meter, for any month. Only spending above the
annual budget is "over"; spending ahead of the tick gets no colour of its own. Annual
amounts carry "/年" (monthly "/月") on the budgets page, and monthly and annual sums are
never added. In "全部" the monthly comparison leaves annual accounts out: their month's
spending is a line under the total and a second, indigo segment on the trend bars, and
an "年度预算" card lists each annual account (shown only when one exists). An annual
account's trend shows its calendar year: monthly bars, the running total as a line, the
annual budget as a solid line and the even pace as a dashed one; months after the selected
one are empty.

## Typography

Font stack (`--font-sans`): `"Inter Variable"`, then system UI fonts, then
`"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei UI", "Microsoft YaHei",
"Noto Sans CJK SC", "Source Han Sans SC", "WenQuanYi Micro Hei", sans-serif`.

- **Inter is bundled** from `@fontsource-variable/inter` and served by the app itself: no
  font CDN, so it works on a LAN with no internet. It supplies Latin letters and, above
  all, the digits, which therefore look the same on Windows, macOS, Linux and phones.
- **Chinese falls through to the platform's own UI font** (PingFang on Apple, Microsoft
  YaHei on Windows, Noto/Source Han on Linux and Android). A CJK webfont is several
  megabytes and would not look better than the system one.
- **Tabular figures everywhere a number appears**: the `num` utility sets
  `font-variant-numeric: tabular-nums`. Digits have equal widths, so amounts align in
  columns and do not jitter when the month changes.

| Role | Size / line height | Weight | Used for |
|---|---|---|---|
| Display (`text-display`) | 34 / 40 px, -0.02em | 600 | The month's total spending |
| Title (`text-lg`) | 18 / 28 px | 600 | Page title |
| Heading (`text-base`) | 16 / 26 px | 600 | Card titles, key figures |
| Body (`text-sm`, the default) | 14 / 22 px | 400, 500 for amounts and names | Table rows, forms |
| Caption (`text-xs`) | 12 / 18 px | 400 | Labels, percentages, chart ticks |

Line heights are taller than Latin defaults because Chinese glyphs fill the em box.
12 px is the floor for Chinese text; only digits and the "超支" badge go to 11 px.

## Spacing, radius, elevation

- **4 px grid** (Tailwind's default spacing scale). Card padding 20 px; gap between cards
  20 px; page gutter 16 px on phones, 24 px from `sm`, 32 px from `lg`.
- **Table rows** about 48 px for level 1 and 38 px for level 2: the two levels differ in height,
  background (`--muted` at 40%) and indent, not in font size alone.
- **Radius** from one variable, `--radius: 0.5rem`: controls 8 px, cards 14 px
  (`rounded-xl`), chips and meters fully round.
- **Elevation** is one token, `--shadow-card`: a 1 px shadow at 4% in light, none in dark.
  Surfaces are separated by the hairline border; nothing floats except popovers.
- **Content width** is capped at 1200 px so the table's columns stay within one eye span.

## Layout

- **From `lg` (1024 px)**: fixed 224 px sidebar; a three-column grid with the month summary
  (1) beside the 12-month chart (2), then the category table (2) beside the share chart (1).
- **Below `lg`**: one column in reading order: summary, trend, table, share. A top bar and
  a bottom tab bar replace the sidebar.
- **Below `md` (768 px)** the table folds: budget, remaining and meter move under the
  category name, the amount stays right-aligned with the percentage under it. Nothing
  scrolls sideways at 360 px.
- **Every page has the same header**: the page title (`text-lg`) on the left, the budget
  account selector ("全部" or one budget account; Dashboard and budgets) or, on settings,
  the tabs on the right. The transactions page has no header control: its filters (month,
  channel, budget account, category) sit above the table. Content is cards
  (`rounded-xl border bg-card shadow-card`) separated by 20 px, as on the Dashboard.
- **Other tables fold the same way.** Transactions: below `md` the date, category and
  channel move under the counterparty and only the amount and an edit button stay in
  columns; the note has its own column only from `lg` and otherwise sits under the counterparty with a
  note icon. Budgets: below `md` the amount in force moves under the category name; in
  the "全部" view each level-2 row names its budget account in muted text under its name.
  Settings → 分类 shows a level-2 category's budget account as a small outlined chip.

## Charts

Recharts, always through the shadcn/ui wrapper (`src/components/ui/chart.tsx`): a
`ChartConfig` maps series to token variables and `ChartTooltipContent` renders tooltips
with the same typography as the rest of the UI.

**12-month trend: bullet bars.** The budget is a wide pale bar (`--chart-budget`) and the
actual a narrow solid bar inside it (`--chart-actual`, the brand teal). Within budget, the
solid bar stays inside the pale one; over budget, it breaks out of the top and turns
`--chart-over`. This shows both values and their relation in one column per month, where
two side-by-side bars would make the eye compare heights 24 times. A month without a
budget has no pale bar. The selected month has an `--accent` band and a bold label; any
point in a month's column is a click target. The value axis has four round steps
(`niceTicks` in `pages/dashboard/model.ts`) with compact labels ("¥1.5万"); grid lines are
horizontal only and use `--chart-grid`.

**Share of spending: donut plus list.** The donut gives the proportions, the list beside it
gives the exact amounts and percentages, largest first; the total sits in the centre. At
most seven slices: the rest are merged into "其他" (`--chart-8`, a neutral).

Categorical palette (`--chart-1` to `--chart-7`): teal, magenta, green, indigo, sand, sky,
violet, at similar chroma, alternating in lightness so neighbours differ even without
colour vision. **It contains no amber and no red**, because those two hues mean "near" and
"over" everywhere else. A category's colour comes from its position in the shown
category order, not from its rank this month, so it keeps its colour from month to month.
(With more than seven level-1 categories, colours repeat.)

## Number formatting

- Money comes from the API as decimal strings and is formatted by `Intl.NumberFormat`
  (`zh-CN`, `style: "currency"`) directly from the string; arithmetic is done in integer
  cents (`src/lib/money.ts`). No amount is ever converted to a float for display.
- `currencyDisplay: "symbol"`: in `zh-CN` this gives `¥` for CNY but `US$`, `JP¥`, `HK$`
  for the others, so a non-CNY base currency is never shown with the yuan's sign.
- Negative amounts (a month where refunds outweigh spending) are shown as `-¥185.00`.
- Percentages are whole numbers in tables and meters and one decimal in the share list.
- Months are written `2026年10月`; chart ticks use `10月` (just `10` on phones) with the
  year under the first tick and under each January.
- Transaction days are `10月8日`, with the year (`2025年12月3日`) only outside the current
  year; timestamps (token created, last used) are `2026年10月10日 14:32` in the browser's
  time zone (`src/lib/date.ts`).

## Data-entry pages

The transactions, budgets and settings pages add no colours: they reuse the tokens above
with these meanings.

- **Refunds** (negative amounts) are set in `--positive` with a "退款" chip on
  `--positive-soft`: money coming back is good news, and the chip keeps it findable
  without colour. Expenses stay in the foreground colour; only the amount is coloured.
- **Unsaved edits** on the budget page carry a `--primary` edge on the left of the row
  (the same 3 px inset edge an over-budget row has in vermilion), a primary input border,
  an "已修改" chip on `--accent` (from `sm`), and "原为 ¥x" under the input, so the
  previous value is never lost from view. A save bar, pinned above the tab bar on phones
  and to the bottom of the screen from `lg`, counts the edits and repeats the month they
  take effect from.
- **Budget inputs**: empty means "未设预算" (shown as the placeholder), `0` is a budget of
  zero. The currency sign sits inside the input on the left, the figure is right-aligned
  in tabular digits like every other amount. The level-1 subtotal and the total are
  computed from the inputs as the user types and are never inputs themselves.
- **The effective month** is explained next to the stepper in an `--accent` panel: from
  which month the amounts apply, that earlier months keep theirs, and what clearing and
  zero mean.
- **Dialogs** (`src/components/ui/dialog.tsx`, `alert-dialog.tsx`) are popover surfaces
  with `rounded-xl`; buttons stack full-width on phones with the primary action on top.
  Destructive confirmations use the `destructive` button (`--over`), start with focus on
  "取消", stay open while the request runs, and show the backend's refusal in place
  (`CATEGORY_IN_USE`).
- **The one-time token** is shown in a monospace, read-only field (selected on focus)
  beside a primary copy button, under a `--warning-soft` panel saying it will not be shown
  again. The dialog ignores clicks outside it; closing takes the button or Escape.
- **Status chips** follow one shape (fully round, 11 px, medium): "超支" and "退款" use the
  state colours, "已修改" and "有效" use `--accent`, neutral facts ("已撤销", "已确认重复")
  are outlined.
- **Copy buttons** confirm with a check mark in `--positive` for 2 s. Copying works over
  plain HTTP on a LAN too (`src/lib/clipboard.ts` falls back when the Clipboard API is
  missing).

## States

Every data view has four states, implemented on every page: loading (skeleton
blocks in the final layout, so nothing jumps), empty (what is missing and how data gets
in), error (the backend's own Chinese message, its reason code, and a retry button), and
loaded. Changing the month (Dashboard, budgets) or the page or filter (transactions)
keeps the previous result on screen at 60% opacity until the new one arrives.

## Motion and accessibility

- Motion is limited to meter width, chevron rotation and opacity, 150 to 300 ms, and is
  switched off under `prefers-reduced-motion`. Charts do not animate.
- Meters have `role="meter"` with a label and value text; expandable rows are buttons with
  `aria-expanded`; the month can be changed with the previous/next buttons as well as by
  clicking the chart; focus rings use `--ring` on every control.
- Dialogs trap focus, close on Escape and give focus back to the button that opened them
  (`useRestoreFocus`). Every icon-only button (edit, delete, rename, copy, clear) has an
  accessible name that includes what it acts on ("删除「买菜」").
- The theme follows the system on first visit and is then remembered (`localStorage`,
  key `eg-theme`); it is applied before first paint by a script in `index.html`.
