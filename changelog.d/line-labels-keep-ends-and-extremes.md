### Fixed

- A line chart with `valueLabels: 'all'` that cannot print every value now keeps the first and last value of each series. Before, it gave the whole row up, so it could show fewer values than `'last'`. A rank chart is unchanged.
- A line chart with `valueLabels: 'extremes'` now prints the lowest value next to the highest. Before, the thinning sweep treated them as one row, and a wide high label could remove the low. A narrow trough or peak that has no seat over or under its point now takes a seat level with it.
