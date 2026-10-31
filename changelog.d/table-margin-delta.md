### Fixed

- A table row calc that is not linear, such as a margin `gp / rev * 100`, now prints the change of the row's own cells in a delta column. A margin of 20.0% against 10.0% printed 30.0%, the ratio of the two changes. It now prints 10.0%. Row calcs that only add, subtract or scale by a literal print as before.
