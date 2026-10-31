### Fixed

- `options.magnitude` takes a unit out of a row's cells only when the row prints a scale letter. Before, a row that stayed in whole units under a forced magnitude, such as `$1.2` or `1.2x`, lost its `$` or `x` from every cell and carried it on the row label. At `'million'`, such a row printed "215.9" with `$` on the label, and now prints "$215.9". A row whose figures do scale keeps its `$M` on the label.
