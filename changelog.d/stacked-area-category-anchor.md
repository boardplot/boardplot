### Fixed

- On a stacked or 100% stacked area, an annotation anchored to a category without a series now reads the stack total, as on a stacked column, bar, combo and mekko. Before, a string anchor or `{ categoryId }` read the bottom band and could print its value above the stack, where it read as the total. This also changes CAGR, difference and the default CAGR span on a stacked area: they compare stack totals and no longer name the bottom series. To keep the old reading, anchor to the series: `{ "categoryId": "2030", "seriesId": "<bottom series>" }`.
