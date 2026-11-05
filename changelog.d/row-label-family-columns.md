### Added

- `columnOverrides` on `bullet`, `dot`, `likert`, `butterfly`, `slope`, `kpi`, `pyramid`, `box`, `funnel` and `bar` sets a column's `width`. A wide width takes room from the plot first and stops at the plot floor with a warning. Nothing refuses because of a width. `{ "columnOverrides": { "label": { "width": 200 } } }`
- `columnOverrides` also takes `align` on `bullet`, `butterfly`, `dot`, `kpi`, `likert`, `pyramid` and `slope`, and it beats `rowLabels.align`. `{ "columnOverrides": { "label": { "width": 180, "align": "right" } } }`
- `columnOverrides` takes `headAlign` and `label` on the types that print a head. `{ "columnOverrides": { "gap": { "label": "To plan", "headAlign": "left" } } }`
- `butterfly` `columnOverrides.label.width` beats `centerColumnWidth`. `{ "centerColumnWidth": 120, "columnOverrides": { "label": { "width": 160 } } }`
- `bullet` `columnVisibility` leaves out `actual`, `share` and `delta` under `percentOfTarget`, and `target` and `gap` with the target columns. An id the current form does not draw warns with the list. `{ "columnVisibility": { "share": false } }`
- `bullet` `columnOrder` moves `actual`, `share`, `delta`, `target` and `gap` around `plot`. `{ "columnOrder": ["target", "gap", "plot"] }`
- `bullet` `labels.position` and `labels.direction` drop the "below target" and "higher is better" lines on their own. `labels.annotation: false` still drops every line. `{ "labels": { "direction": false } }`
- `likert` `columnOrder` moves `net` and `base` to the other side of the marks. `{ "columnOrder": ["net", "plot", "base"] }`
