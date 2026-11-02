### Added

- `sort.categories` on variance, bullet, likert and butterfly. Variance ranks by the signed drawn difference, using delta percent in relative mode. Bullet ranks by value divided by target when every row has a positive target, otherwise by raw value. Likert ranks statements by net score and keeps the response scale ordered. Butterfly uses the `sortBy` measure, default sum, with the direction from `sort.categories`. Ties keep authored order and missing values sort last.
- `topN` on dot and variance keeps the n largest categories by absolute first-series score or dumbbell gap, and absolute drawn variance difference respectively. No Others row is drawn. A note names the omitted categories. Authored rest settings and threshold warn when ignored.

### Fixed

- Sort and topN refusals now name time sequences, stages, bridge steps, matrix axes/cells, histogram bins or box groups where those structures require their order or full set. Dot, variance, likert, butterfly and bullet are no longer described as sequences that cannot be sorted.
- Likert refuses `sort.segments` because the response scale is an ordered axis. `sort.categories` orders the statements without changing the scale or diverging baseline.
