### Fixed

- A heatmap cell that the rows mark `suppressed`, `nm` or `na` is no longer called "No data". The rows adapter now writes the state into the new optional series `states` list, one entry per category, and a heatmap takes the same list in its data. A stated cell stays hatched, the key names each state present beside "No data", and the cell, its hover card and `reading.values.byState` carry the state. A heatmap with no states draws as before.
