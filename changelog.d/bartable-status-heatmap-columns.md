### Added

- `columnOverrides` on bartable, heatmap and status sets the width, alignment and head text of one column, for example `{ "columnOverrides": { "label": { "width": 170, "align": "left" }, "fy": { "width": 150, "label": "Full year", "headAlign": "right" } } }`. The ids are `label` and the column ids of the data: `data.columns` and `data.panels` on bartable, `data.categories` on heatmap, `data.columns` on status. A width beats a panel `weight`. Under `sharedScale` or a cascade a panel width warns `option-ignored`. A width that does not fit warns `generated-column-width-capped` and never refuses.
- `columnOrder` on bartable moves the blocks `numbers` and `panels`, for example `{ "columnOrder": ["panels", "numbers"] }`.
- `columnHeads: false` on bartable drops the head row with its height and rule, for example `{ "columnHeads": false }`.
- `totalPosition` on bartable puts the Total row at the `top` or `bottom`, with its rule and ground, also under a cascade, for example `{ "totalPosition": "top" }`.
- `labels.point: false` on bartable stops the values in the segments and at the bar ends, for example `{ "labels": { "point": false } }`. Number columns, shares, growth and the Total row keep their numbers.
