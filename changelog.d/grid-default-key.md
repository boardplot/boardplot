### Changed / may need action

- A grid with no `options.legend` now draws the series key when a chart panel draws two or more series and no label names them. Before, the key appeared only under `legend: 'top'`, `'auto'` or `'none'`, and such a grid drew coloured marks with no names. The rule is the one `legend: 'none'` follows, so the key lists only the series no panel names. Grids of single-series panels keep their look. To name a panel's series without the grid key, set `legend: 'top'` on that panel.
