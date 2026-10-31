### Added

- Histogram option `bins.openAbove`: every observation at or above the value goes into one open last bin. The other bins keep their equal width, and their edges run through the value. The open bin stands a small gap apart, always prints its count, and is named under its bar with the largest observation, such as `≥ 1,600 (max 5,846)`. The axis caption adds `open bin ≥ 1,600`. `bins: { openAbove }` keeps the automatic width; `{ width, openAbove }` sets it. A value outside the observations is ignored with the warning `histogram-open-above-ignored`. An authored anchor that misses the value gives way with `histogram-open-above-off-grid`.
- Histogram warning `histogram-long-tail` under the automatic bins: when most bins past the first quarter of the axis hold at most 1% of the tallest bin, it names the open bin that would gather the tail, as `bins: { openAbove: <edge> }`. The edge is the first bin edge at or above the 98th percentile, and the open bin holds at most 5% of the observations. Charts without `bins.openAbove` draw as before; to keep the old look, leave out `bins.openAbove`.

### Fixed

- A histogram bin too low to see no longer gets a callout such as `1 in 850–900` when its own count already prints between printed neighbours. Before, the count printed twice. A lone far bin keeps its callout, which names its range. This is a fix with no option for the old look.
