### Removed

- Bar: `baseValue` on every variant but `tornado`, `currentValue` on `grouped`, `stacked`, `stacked100` and `tornado`, `connectors`, `netLine` and `grandTotalLabels` on `grouped` and `tornado`, `averageMarker` on `tornado`, `legend` on `football-field`, and `annotations` and `sort.segments` on `football-field` and `tornado`. An old spec draws the same and warns `option-ignored` with a remove patch.
- Dot: `arrow` and `gapColumn` on `dot` and `lollipop`, with `option-ignored`. `topN.rest`, `restLabel`, `showRestCount` and `threshold` on every dot variant, with `option-deprecated`.
- Funnel: `totalCvr` and `stageShade` on `rows`, `worstDropCallout` and `bandFraction` on `centered`, with `option-ignored`.
- Slope: `diverging` on `lines`, `legend` and `annotations` on `diverging`. Waterfall: `annotations` on `horizontal`. Both warn `option-ignored`.
- Line: `rebase100` on `stacked100-area`, also through `valueAxis.percent`, with `option-ignored`. Heatmap: `cap` on `harvey`. Bartable: `rounding: "nearest"` without a cascade. Cohort: `formatScope` on `pure`, and on the heatmap `sort.categories` and `sort.segments` `asc` and `desc`; `sort.segments: "reverse"` stays.
- Box: `secondaryAxis` and `valueAxis.includeZero`, `percent`, `reverse` and `tickStep`. Butterfly: `sort.segments`. Column and combo: `categoryAxis.crossesBetween`. Likert: `legend.order`. Pareto: `highlight`, `topN.showRestCount` and `topN.threshold`. Dimswitch, gantt and grid: `format`. An old spec draws the same and warns `option-deprecated` with a remove patch, or `option-ignored` on `secondaryAxis`.

### Changed

- Column `grouped`: `connectors`, `netLine`, `grandTotalLabels`, `shareLabels`, `ribbons` and `seriesLabels` keep their warning and gain a remove patch. These keys stay in the schema, because they work on the stacked variants and can keep a narrow grouped column from stepping to bars. The patch is withheld where removing the key would change the drawing.
- Bump `valueAxis.min`, `max` and `break`, a heatmap `cap` on a discrete scale, and `topN` on `tornado` and `football-field` gain a remove patch on their warning. Over the item budget, `topN` has no patch, because the patched spec would be refused.
