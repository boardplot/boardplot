### Fixed

- A table whose columns print different units ("$" and "€") no longer prints `options.unit` in its subtitle ("Revenue in USD"), also under `unitShown`. The column heads name each unit, and `table-unit-overridden` warns that `options.unit` is not printed, with a fix that removes it.
