### Fixed

- The line chart documentation now says that a plain line whose scale does not start at zero keeps a tick at its lowest value with a break glyph, also when `valueLabels` is `'all'` or `valueAxis.show` is false. Setting `valueAxis.includeZero` to true or `valueAxis.min` to 0 starts the scale at zero and removes the tick.
