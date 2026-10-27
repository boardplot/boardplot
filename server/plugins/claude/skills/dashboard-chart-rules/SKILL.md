---
name: dashboard-chart-rules
description: "Chart rules for d3 charts in a Claude Dashboard page: a bridge, actual against plan, a ranking, a trend, shares of a whole, or any chart drawn in dash.onData. Use when you draw, revise or review a chart there."
---

# Dashboard chart rules

These rules make a d3 chart in a dashboard page read like a consulting exhibit: the right chart for the message, every number from the data, labels that do not collide, and colours that keep their meaning and contrast. They work inside the Dashboard type's contract. Where the type's own instructions say more, the type wins.

## Steps

Do the steps in order for each chart. A step is done when each rule under it holds for this chart.

1. **Choose the chart from the message.** Write the message in one sentence first, such as "Price and volume lifted EBIT; costs took back a third". Then take the chart for that job from [references/chart-jobs.md](references/chart-jobs.md): bridge, actual against plan, ranking, trend, or shares of a whole. A chart the person named is the chart you draw.
2. **Get the numbers.** Every number on the chart comes from a dataset cell, the dataset's SQL, or a `dash.calc` (see "Numbers").
3. **Set the order.** Categories and series follow the rules in "Order".
4. **Format the numbers.** One format per axis and per label set (see "Number formats").
5. **Place the labels.** Direct labels, no collisions, and a note for what you drop (see "Labels").
6. **Paint by role.** The type's tokens as `var()`, `dash.colors` bound to series names, and the contrast floors checked on the real surface in light and dark (see "Colour", and [references/colour.md](references/colour.md) for the reads and the checks).
7. **Write the frame.** A title that states the message, and a subtitle with the measure, the unit and the period (see "Frame").
8. **Fit the width.** Draw at `clientWidth`, and keep the chart readable beside a chat (see "Narrow widths").

## Numbers

- Read each value with `Number(cell)`. Cells arrive as text. An empty cell is missing: test `cell === '' || cell == null` first, because `Number('')` is 0. Then check `Number.isFinite`; a cell that is not a number is a missing value, not zero.
- Show a missing value as a gap: no column, a break in the line, an empty cell. Never draw it as zero, because zero is a measured value. If a stack or a total misses a part, label the total as partial ("312 (partial)") and say in the note which part is missing.
- A number the chart prints and the data does not hold (a total, a running level, a share, a delta, a variance) is computed. Compute it in the dataset's SQL when all its inputs come from one query: readers can check the SQL and run it in their warehouse. Use a `dash.calc` only when the inputs cannot share a query (different connectors, or a query and a file). The chart reads those rows; it does not repeat the arithmetic in its draw code.
- Geometry is not a number to cite: a bar's base, a pixel position or a scale domain may be computed in the draw code.
- A total and its parts: compare the sum of the parts with the data's total only when the parts are additive, do not overlap, and have the same unit and scope (revenue by region, cost by line). Then a difference beyond rounding is a data fault: show the sum, and name both numbers in the note. Never sum rates, averages, shares of different wholes or distinct counts: keep the data's total, or compute it from its inputs (total revenue over total orders, not the sum of the averages).
- Shares of one whole print rounded so that they add to 100 %. Use the largest-remainder rule: round down every share, then give one step to the shares with the largest remainders until the sum is 100. Do this in the SQL that makes the shares, or in their `dash.calc` when the inputs cannot share a query.
- No numbers in markup and no arrays of values in a script. A constant the person chose (a goal line) is the one exception.

## Order

- Periods run left to right, oldest first, at equal spacing. A missing period keeps its slot.
- Categories without a natural order sort by value, largest first, so the ranking reads from the top.
- A bridge keeps its business order (the P&L order, the cash walk). Sort it by size only when the message is a ranking.
- Series keep one order in every chart of the page: actual, then prior year, then plan, then forecast; or the order the data gives. The legend, the stack and the end labels use the same order.
- A filter never reorders or recolours the series that stay: the order and the colours come from the series names, not from the position in the filtered rows.

## Number formats

- Use one format per axis and per label set: the same decimals, the same unit, the same scale. Take the decimals from the largest value of the set; below 1, keep two significant digits (0.0341 gives three decimals). Print at most four decimals.
- Use `d3.format` with grouping: `",.0f"` prints 12,345. Use the page's own number marks when the person's locale needs them.
- Scale large numbers with one suffix for the whole set: k, M or B, as in 2.5M. Do not mix 950k and 1.2M in one axis.
- A change label has a sign: +12 and −8. Print the minus as U+2212 (−), the typographic minus, so the digits stay aligned. A total and a level have no plus sign.
- A percentage change is in %, a change of a percentage is in percentage points (pp): 12.0 % to 13.5 % is +1.5 pp.
- A value too small for the shown decimals prints its bound, `<0.1`, not `0.0`. A true zero prints as `0`.
- The unit goes once in the subtitle or the axis title (€k, %, units), not after every label. A currency sign goes in the format (`$1.2M`).

## Labels

- Label marks directly: a line's name at its end, a value at the end of its bar or above its column. A legend makes the eye travel between key and mark; keep it for marks that cannot carry a name, such as the segments of a stack.
- Text uses the type's tokens: `font-family: var(--font-anthropic-sans)`; ticks, value labels and notes at `var(--cds-font-size-caption)`; the chart title at `var(--cds-font-size-heading)` and `var(--cds-font-weight-medium)`. `d3.axis` puts `font-size` 10 and `font-family` sans-serif on its group: remove both with `.attr('font-size', null).attr('font-family', null)`.
- No two labels overlap, and no label is cut by the chart edge. Measure each label (`getComputedTextLength()` or `getBBox()` after you set its text) and test its box against the placed boxes and the chart area before you keep it.
- When labels do not fit, drop them in this order, and keep the rest:
  1. Keep the first, the last, the highest and the lowest value of a series, and the value the title names.
  2. Drop the other values first.
  3. Drop a segment's value when the segment is shorter than the label height plus 4 px.
- Name what you dropped in one note under the chart: "Not labelled on the chart: North 42, West 35." Name up to 8 items, then count the rest ("and 12 more"). A tooltip shows every value, so the dropped ones stay in reach.
- Put category names on one line under the columns. When they do not fit upright, turn the chart horizontal (bars). Do not rotate or cut names: rotated text is slow to read, and a cut name can match another.
- Every chart that plots values gets a tooltip that stays inside the page. Do not use the SVG `title` element for it.

## Colour

- Paint with the type's tokens as `var()`, so the chart follows the theme: `fill="var(--cds-chart-muted)"`, `style="fill: var(--color-ok)"`. Read a token as a literal colour only to check a contrast or to choose the text colour on a fill.
- Chart roles and their tokens:

  | Role | Token |
  |---|---|
  | Series | `dash.colors[i]`, bound to the series name |
  | Muted marks (the items the title does not name) | `--cds-chart-muted` |
  | Gridlines | `--cds-chart-grid` |
  | Axis line | `--cds-chart-axis` |
  | Connectors and reference lines | `--cds-chart-reference` |
  | A value past a limit | `--cds-chart-status-critical` |
  | Good and bad change | `--color-ok`, `--color-bad` |
  | Text, muted text | `--color-fg`, `--color-fg-muted` |

- One measure takes one colour. Highlight only the item the title names; the other marks take `--cds-chart-muted`. A colour per bar is a code the reader must learn.
- Bind each series colour to the series name with one map for the whole page, made before any filter: `{Revenue: dash.colors[0], Cost: dash.colors[1]}`. A filtered chart then keeps each series' colour.
- Good and bad are for a change with a direction only: a rising cost is bad. `--color-ok`, `--color-warn` and `--color-bad` are text colours: as a fill each must pass 3:1 against its surface, and a label on that fill needs its own check.
- Scenarios: actual is solid, prior year is a light tint of the same colour, plan is an outline (surface fill, coloured stroke), forecast is hatched or dashed. The reader then sees where the actuals end.
- Check contrast against the surface the element sits on: `--color-panel` for marks and text on a card, `--color-bg` for the page. A label inside a mark is checked against that mark's fill: choose `--color-fg` or the surface colour, whichever passes, and check the final choice.
- The floors: text 4.5:1, muted text 3:1, marks 3:1. Good and bad must look clearly different, also to a colour-blind reader. Check them in light and in dark.
- When a series colour fails, choose the replacements over the whole series map at once, so that two series never share a colour. Then check the final palette: every series apart from the others, good apart from bad. When no passing colour is left, tell the series apart by a pattern or a direct label instead of colour, and say so in your hand-over.
- Draw again when the theme changes: on a `data-mode` change of the page (a MutationObserver on `document.documentElement` with `subtree: true` and `attributeFilter: ['data-mode']`) and on the `prefers-color-scheme` media query. [references/colour.md](references/colour.md) has the code.

## Frame

- The title states the message: "South sells 38 % more than West", not "Revenue by region". When the data changes, the title must still be true: build it in `dash.onData` from the same rows, or keep it to a neutral statement.
- A number in a title is a value: put it in its own element, marked with `data-source`, `data-field` and `data-where` (or a calc's id), and fill it in `dash.onData`.
- The subtitle names the measure, the unit and the period: "Revenue, €k, Q3 2026".
- Draw no source line: the type's Sources shows each marked element's source, slice and freshness.
- Notes go under the chart for what Sources does not show: dropped labels, a partial total, a data fault. Keep them to at most 3 lines, 2 below 720 px width.

## Narrow widths

- Draw inside `dash.onData` at the container's `clientWidth`. Give the `<svg>` `width="100%"` and a `viewBox` of the drawn size.
- Place chart cards in the type's grid: `grid-template-columns: repeat(auto-fit, minmax(min(100%, 20rem), 1fr))`. Two cards share a row when there is room.
- Keep the chart readable at 400 px, the width beside a chat. A column or line chart needs about 480 px for its full form. Below that, draw the compact form: the essential labels only (step 5 order), tight spacing, the whole title wrapped, never cut, and no subtitle when the plot would be under 80 px high.

## The type's contract, as these rules use it

- d3 v7 is the global `d3`. No network, no modules, no other libraries.
- The chart's box starts empty with the class `dash-skeleton`. Remove the class when the data arrives or the load fails. On `status === 'error'`, draw the type's one-line "Failed to load" state. Give the box a `min-height` equal to its drawn height, so a state change moves nothing below it. The `—` placeholder is for single value elements, not for a chart's box.
- Mark the chart's box with `data-source="<id>"` (several ids, space-separated: the dataset and the calc). A value printed outside the chart is marked on its own element with `data-source`, `data-field` and `data-where`.
- `dash.onData(fn)` runs on every status and every width change. Redraw everything there; do not leave an old chart up.
- Values from data are text to show with `.text()` or `textContent`, never `.html()` or `innerHTML`.
- The type reports back a mark whose value differs from the data, or a mark that matches no row. Mark only what your scripts fill.
