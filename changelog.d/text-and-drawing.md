### Added

- `options.labelOffsets` moves a label by a set distance from the seat it would take, keyed by label id, such as `{ "annotation:callout-2": { "y": 40 } }`. A blocked move keeps the label in its seat and warns `label-offset-blocked`. An unknown id warns `label-offset-unknown`. A value moved off its own bar prints in page ink with a halo.
- Four drawing annotations place text and simple shapes on data positions: `text`, `line`, `arrow` and `box`. A point is an anchor or `{ categoryId, value }` in axis units. A value outside the plot warns `bad-anchor` and draws nothing. A stretch that would cross text is cut around it and warns `draw-crosses-text`.

### Changed

- A waterfall `bracket` stands directly above its own bars and their values, in place of one row at the top of the plot. It falls back to that row when its seat is taken.
