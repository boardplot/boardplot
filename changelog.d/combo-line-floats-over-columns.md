### Changed / may need action

- On a dual-axis combo whose line cannot run above the columns on any pair of scales from zero (a line whose low is far under its high), the line no longer runs through the columns. The columns keep the lower 55% of the plot, and the left ticks stop at the first tick over the tallest column. The line floats in the band above them on its own scale from its low to its high. The right ticks are dropped, and the line prints its first, last, lowest and highest values (every value up to 8 categories). The info lint `dual-axis-line-floated` names the change. The old look, with the line on the synced right scale through the columns: `{ "options": { "dualAxis": { "anatomy": false } } }`.

### Added

- The warning `line-flat-on-scale` fires when a line on the shared scale spans under 2% of that scale, so it lies flat beside larger columns. Its fix puts the line on an acknowledged secondary axis (`axis: 'secondary'`, `secondaryAxis.acknowledge: true`). The engine never moves the line by itself.
