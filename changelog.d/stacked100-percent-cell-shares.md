### Fixed

- A 100% column stack whose cells are given as percents (`{ "pct": 24.8 }`) now prints the share in each segment, as the same stack of plain numbers does. Before, it printed no segment value at all, at every size and with every `labelDensity`, and no warning named the loss. Segments too short for their value go to the note, as for plain numbers. Under the default `rounding: "sum-consistent"`, percent cells that add to exactly 100 now print shares that add to 100%, as on a bar chart; before, each one rounded alone. To bring back the old look, set `labels: { "segment": false }`.
