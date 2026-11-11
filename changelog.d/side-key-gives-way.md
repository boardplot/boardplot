### Fixed

- A heatmap or cohort chart with `legend: 'left'` or `'right'` no longer refuses a width between two widths that draw. Where the key beside the plot leaves the chart a floor above its width, the key stands in the row above the plot, with the `legend-side-fallback` warning, as gantt already did. A 24-week cohort with large bases was refused from 343 to 396 px and now draws from 319 px; a capability heatmap was refused at 286 px and now draws from 280 px.
