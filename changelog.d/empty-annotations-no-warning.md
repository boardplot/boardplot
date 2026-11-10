### Fixed

- An empty `annotations` list, at the root or in `options`, no longer warns `option-deprecated` ("annotations is retired and ignored") on the chart types that draw no annotation (bartable, choropleth, cohort, dimswitch, grid, histogram, kpi, sankey, sparkline, status, table, tilemap, treemap, waffle). A list with entries still warns, with its remove patch.
