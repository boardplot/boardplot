### Fixed

- Grid keys omit identical swatches when each panel title matches its only key name. An explicit key request reports `grid-legend-redundant` with a fix to remove `options.legend`. Keys with distinct appearances or names missing from panel titles remain.
