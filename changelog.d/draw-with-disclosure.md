### Changed / may need action

- Treemaps accept null item values. Zero and null items are left out with `treemap-item-left-out` and a note naming the items.
- Choropleth and tilemap leave unknown data region ids out with a warning and a note. A map whose listed ids are all unknown still refuses.
- A slope with more than two categories draws the first versus the last, warns `slope-too-many-points` and names the omitted categories in a note.
- A football field leaves out methods without a range with `football-field-method-without-range` and a note. At least one method must have a range.

### Fixed

- Treemap totals, shares, group keys, cell counts and item limits count only drawn items.
- Map region ids and aliases match without regard to case after exact matches. Data, row inputs, labels and overlays share the same resolution and duplicate detection.
- Football-field sorting, scale, totals and mean exclude methods without a range.
