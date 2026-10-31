### Changed / may need action

- An area spark on a KPI card now starts its scale at zero, as a column spark does. Before, the floor was the series minimum: ARR that rose 50%, from 1.21bn to 1.82bn, filled from nothing in January and read as growth from zero. The wash now fills to zero, and a series below zero fills up to the zero line. A line spark keeps its min-max range. A theme with `surface.sparkWash: false` draws an area spark as a line and keeps the min-max range too. Table cells draw only line and column sparks, so table cells do not change. To bring back the old look, set the theme override `{ "surface": { "sparkAreaBase": "min" } }`.

### Added

- Theme field `surface.sparkAreaBase`: `'zero'` (default) or `'min'`. `'min'` starts an area spark's scale and wash at the series minimum.
