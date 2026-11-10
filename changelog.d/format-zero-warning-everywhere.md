### Fixed

- `format-hides-values` now warns wherever an authored format prints a nonzero value as zero: a series format, a bar table column, a table column or cell, a grid panel's own format, and a `%` format over values in points. It read only a chart's `options.format` before. Each warning carries a fix with a finer example at that format's path.
