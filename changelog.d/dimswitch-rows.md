### Added

- A dimswitch can turn its automatic size bars off: `{ "bars": false }`. Scale, precision, data and judgement stay.
- A dimswitch can leave out its Total or its group heads: `{ "rowVisibility": { "total": false, "group:Unit costs": false, "group:": false } }`. The ids are `dimension.total.id`, `group:<measures[].group as authored>` and `group:` for the ungrouped section. In by-member the whole Total block goes. In by-measure each Total line keeps its label and folds with blank cells, because it carries the KPI name and owns its members. Members print the same figures with the Total hidden. A table with no value left warns `dimswitch-labels-only`, and an id the table does not draw warns `generated-id-unknown`. Neither refuses.
- `totalPosition` now works on a by-member dimswitch: `{ "variant": "by-member", "totalPosition": "bottom" }` moves the Total block after the last member. In by-measure the key warns `option-ignored`.
