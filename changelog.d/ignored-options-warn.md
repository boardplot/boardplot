### Changed

- A setting a type accepts but cannot draw now warns `option-ignored` and is removed, with a sentence on what it does on the types that have it: `focus` and `labelDensity` on table and dimswitch, `highlight` on bartable, `valueAxis` on grid, treemap and waffle, and `topN.threshold` on butterfly, mekko and pie. Before, the chart drew the same and the request passed without a warning. `valueAxis.break` on a grid stays refused. `describe` lists these settings as ignored, and `describe` of one of these paths says the type ignores it.
- A bar table panel in a grid with `highlight` now takes the grid's shared series colours, so a series keeps one colour across panels. Before, the setting left the panel out of the shared colour assignment: with two bar table panels whose series run a, b and b, a, series a was dark in the first panel and blue in the second. Remove `highlight` from such a panel to keep the new look; there is no setting that brings back the old colours, because they came from a dropped setting.
- A value of one of these settings that the schema refused before is now removed with the same warning, and the chart draws. Example: a pie with `topN: { n: 1, threshold: "oops" }` was refused and now draws with `option-ignored` on `topN.threshold`.

### Fixed

- A React chart now reports the warnings of a prop update that adds or removes a setting the type ignores (for example `animate`, or `highlight` on a bar table). Before, the layout options stayed equal, the chart kept its earlier layout, and `onWarnings` kept the old list.
