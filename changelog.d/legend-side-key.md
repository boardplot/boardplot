### Added

- `options.legend` takes `'right'` and `'left'`, as a string or as `{ position }`, on every chart type that draws a key. The key stands in a column beside the plot. Before, both values were refused. Where the plot block would keep under 68% of the chart width, or the column is taller than the chart, the key stays in the row above the plot and the warning `legend-side-fallback` says why. A tilemap and a choropleth take the same values, and the heatmap gradient key stays above the matrix at `'left'`. Charts without a named side key draw as before.
