### Fixed

- A DimSwitchChart no longer throws when it is given a `prepared` snapshot. The prop was passed on to the table inside, which threw "Expected a prepared table chart." for the snapshot that `prepareChart` returns for any chart that is not a table. A dimswitch is compiled from its variant, depth and splits, so no frozen snapshot can match it. The prop is now ignored, and the chart draws from `data` as it does without the prop. The type of `DimSwitchChartProps` no longer accepts `prepared`.
