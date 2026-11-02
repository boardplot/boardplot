### Added

- Column and combo charts take `options.categoryAxis.dateTicks` (`years`, `quarters`, `months`, `weeks`, `days`) on dated categories, as a line does. A short tick marks the first category of each calendar interval at the middle of its band, the labels name those intervals, and every column keeps its place. `categoryAxis.crossesBetween` stays a line setting: column and combo ignore `false` and warn `cross-between-ignored`. Without `dateTicks` the drawing is unchanged. Before, `categoryAxis` was refused on column and combo with `invalid-options`.
