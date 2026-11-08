### Changed

- Waterfall: the brackets of one bridge now stand on one row, the lowest row that clears every bracketed span and its values. Before, each bracket stood right above its own steps, so two brackets stood at different heights, and the row changed with the width. The plot keeps the room for the top row only where a bracket stands there. Where every bracket stands on its row below, the empty band under the subtitle goes back to the plot, for a single bracket too: an automatic-height card gets shorter, and a fixed card gets a taller plot. A single bracket keeps its seat right above its steps.
- To bring back the earlier look, set `bracketRow: "span"` on the waterfall. It keeps each bracket right above its own steps and the full room above the plot.

### Added

- Waterfall option `bracketRow`: `"shared"` (default) or `"span"`.
