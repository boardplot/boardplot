### Fixed

- A table column under `options.magnitude: "thousand"` or `"million"` no longer prints a small nonzero value as 0. Before, a cost-per-order column with format `$1.1` printed $42 and $71 as "0", and a `percentDelta` column on it printed "n.m." in every row. Such a column now reads in whole units at its format's decimals ("42.0", with "$" in the column head) when a forced thousand would print a value as 0, or takes more decimals at the forced million. A money row already followed this rule. Columns whose values print nonzero at the forced scale keep it.
