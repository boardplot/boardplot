# Chart jobs

One section per business job. Each gives the chart, how to build it in d3, and the rules that make it read. Data in the examples is synthetic.

## Bridge: what moved a number from A to B

Use it when an opening and a closing value exist and the steps add up to the change: an EBIT bridge, a cash walk, budget to actual. Two values only: a column pair with the difference. Steps with no business order: a ranked bar chart.

Build it as stacked columns with an invisible base:

- The rows are the steps in business order, with an opening total first and a closing total last. Compute the running level in the dataset's SQL (a window `SUM(...) OVER (ORDER BY step_order)`), or in one `dash.calc` when the inputs cannot share a query. Return one row per step: `{step, kind, delta, base, top, end}`, where `kind` is `total` or `delta` and `end` is the running level after the step. The draw code only reads these rows.
- A total column stands on zero and goes to its value. A delta column starts at the level before it: `base = min(before, after)`, `top = max(before, after)`. Draw only the visible part, from `base` to `top`; the base is empty space.
- Draw the closing total from the running sum: the steps of a bridge are additive by definition. When the data also holds a closing value, compare: a difference beyond rounding is a data fault that the note names with both numbers.
- Totals take the first series colour (`dash.colors[0]`). An increase takes `--color-ok`, a decrease `--color-bad`, each checked as a fill (3:1 against the card's `--color-panel`). In a cost bridge, a rising cost is bad: decide the colour by the effect on the result, not by the sign.
- Thin connectors (1 px, `--cds-chart-reference`) run at each step's `end` level, from the column to the start of the next one, so the eye follows the level. An increase's connector leaves from its top, a decrease's from its lower end, and a total's from its top.
- Label each delta with its sign (+12, −8) beyond the column end in the direction of the change. Label totals without a sign, above the column.
- End on a total. Show about eight steps or fewer; fold the small ones into one "Other" step at a place that keeps the business order. Add a subtotal where the business reads one (gross profit before overheads).
- When the step names do not fit upright under the columns, turn the bridge horizontal: steps as rows, names left, one per line.

## Actual against plan, with the variance

Use it for actual against plan or prior year, per period or per unit.

- Draw the actual as solid columns. Draw the plan as an outline column (surface fill, a 1.5 px stroke in the series colour) beside or behind the actual, on the same scale. Prior year is a light tint of the actual's colour.
- Under the columns, on the same category axis, draw the variance as its own row: one bar per category from a zero line, in `--color-ok` where the variance helps the result and `--color-bad` where it hurts.
- Compute the variance (actual minus plan) in the dataset's SQL, or in a `dash.calc` when actual and plan come from different sources; never in the draw code. Label it with its sign; a relative variance is in %, a variance of a rate is in pp.
- Grouped AC and PL columns without the variance row make the reader find each gap by eye. Draw the variance row.

## Ranking

Use it for items without a natural order, or names too long for a column.

- Draw horizontal bars, sorted by value, largest at the top. Names sit left of the bars, on one line.
- The value axis starts at zero: a bar's length is its value, so a cut axis overstates the differences.
- Show at most 15 bars. Fold the tail into one "Others" bar at the bottom, when the values add up.
- One colour for all bars. Highlight only the item the title names; the others take `--cds-chart-muted`.
- Label each bar's value at its end. Drop the axis when every bar has a label.
- A stacked bar keeps to about five segments: only the first segment and the total share a baseline.

## Trend over time

Use it for ordered periods, from about five points, and for comparing the shape of several series. Two points only: a slope. A few periods where each value matters: columns.

- Periods at equal spacing in time order. A missing period is `null` and makes a gap (`d3.line().defined(d => d.value !== null)`), never a line across it.
- Straight segments (`d3.curveLinear`). A smoothed curve shows values between periods that nobody measured.
- Name each line at its right end, in its colour, not in a legend. Move end labels apart vertically when they collide; keep each one level with its line where it can.
- Print the last value, or the first and the last, not every point. The tooltip shows each value.
- Draw at most five lines. Grey the others, or split them into small charts side by side.
- A line may start above zero. An area must start at zero, because its filled height reads as the value.
- Draw forecast and plan periods dashed, so the reader sees where the actuals end.

## Shares of one whole

Use it for the mix of one total, or how the mix changes over periods.

- For several periods, draw 100 % stacked columns: one column per period, the parts in the same order in every column, the largest part at the bottom. Keep about five parts; fold the rest into "Other" at the top.
- For one total with few parts, a single 100 % bar or a ranked bar of shares reads better than a pie. A pie with more than six slices does not read, and pies do not compare periods.
- Compute the shares in the dataset's SQL, or in a `dash.calc` when the inputs cannot share a query, rounded so that they add to 100 % (the largest-remainder rule in SKILL.md "Numbers"). Print each share inside its segment only when the segment is taller than the label plus 4 px; else drop it and name it in the note.
- Print the absolute total above each column, from the same SQL or `dash.calc` that supplies the shares, with its own number format, not as a share.
