### Changed / may need action

- A Pareto chart with a vital few now scales its left axis to the total by default (`totalScale` turns on). 100% on the right sits level with the total on the left, so the curve starts on the top of the first column and the two axes describe one measure. Before, the left axis stopped at the largest column: 100% sat level with 8,000 while the total was 20,000, and the curve started in the middle of the first column. A flat distribution keeps the column-capped axis, because its columns would shrink to a sliver. An authored `valueAxis.min` or `valueAxis.max` also keeps its scale. To bring back the old look, set the option `{ "totalScale": false }`.

### Fixed

- A Pareto key now carries the vital few's share ("Top one: 70%") when the curve's label at that column has no seat. Before, the share was lost from the chart and only the notes listed it.
- A Pareto scaled to its total keeps its top tick, the total and 100%, when the axis thins its ticks. Before, thinning from zero could drop the top row, and the axes stopped at 800 and 80% under a total of 1,000.
- A Pareto curve point that sits on the threshold rule no longer prints the rule's share a second time beside the rule's label ("80%  80%").
- A column total with a line point exactly on its column top now takes the same seat every time. Before, a sub-pixel rounding difference decided whether the total went inside the column or two rows above it. A column too narrow for its total lifts it only as far as the line needs.
