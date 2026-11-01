### Added

- A slope chart prints each line's change in a right-hand column with `change: "absolute"` (right value minus left value) or `"relative"` (percent change). The column sits on the baseline of each right label under a head such as `Change, pp`, the highlighted line prints bold, and the right rail moves left to make room. A percent unit prints `pp`, other units print the plain difference. The column is off below a canvas width of 576 px. The default is `"none"`.
- A dumbbell dot chart prints second minus first per row with `gapColumn: true`, signed, from the two values as printed (so it foots with the labels), under a head in the chart language (`Gap`, `Abstand`). The plot gives up the width. The default is off. Other dot variants ignore the option and warn `gap-column-dumbbell-only`.
- A likert chart prints each statement's base in a grey right-hand column (`base: "column"`), right of Net, when the values are counts or the items carry `n`. When every statement has the same base, the base prints once in the head instead (`Net, pp · n = 900`). `base: "none"` takes it off. A percent input without `n` has no base to print and draws no column.

### Changed / may need action

- A butterfly chart sorted by `sortBy: "diff"` now prints the difference of each row (b minus a) in a right-hand column under a `Δ` head. A highlighted row prints bold. The chart is wider by the column. The column is off below a canvas width of 576 px. To keep the old look, set `"diffColumn": false`. An authored `delta` annotation of b over a on the same row, without its own text, repeats the column, so only the column prints it; the chart warns `delta-column-covers-annotation` (`diffColumn: false` keeps the annotation).
- A likert chart with counts or per-item `n` now has the base column or the `n = …` head described above, and its bars are narrower by the column. To keep the old look, set `"base": "none"`.
