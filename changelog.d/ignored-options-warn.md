### Changed

- A setting a type accepts but cannot draw now warns `option-ignored` and is removed, with a sentence on what it does on the types that have it: `focus` and `labelDensity` on table and dimswitch, `highlight` on bartable, `valueAxis` on grid, treemap and waffle, and `topN.threshold` on butterfly, mekko and pie. Before, the chart drew the same and the request passed without a warning. `valueAxis.break` on a grid stays refused. `describe` lists these settings as ignored.
