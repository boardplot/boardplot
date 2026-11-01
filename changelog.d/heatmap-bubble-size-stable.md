### Changed

- Bubble heatmaps with size levels keep the same row heights and circle radii when value labels or number formats change. Rows now follow row names and column width. The `survey-journey-bubbles` example at 960 px is 463 px tall with default labels, `labels: false` or `format: "1.0"`. The old heights were 501 px, 614 px and 611 px. To retain the old canvas height for default labels, set `{ "size": { "width": 960, "height": 501 } }`.

### Fixed

- Requested bubble values share one font size across the matrix. The font steps down to the existing label floor before values are omitted together. Matrices with size levels keep values in the largest circles.
