### Fixed

- A table whose columns state different units in their formats ("$" and "€") no longer prints `options.unit` for the whole table, neither in the subtitle ("Revenue in USD") nor as its own unit line ("USD"), also under `unitShown`. The column heads name each unit, and `table-unit-overridden` warns that `options.unit` is not printed, with a fix that removes it. A table with one unit in its heads, or with a column whose format states only a magnitude ("1.2k"), keeps `options.unit` as before.
