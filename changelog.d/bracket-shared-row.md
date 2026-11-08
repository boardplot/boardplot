### Changed

- Waterfall: the brackets of one bridge now stand on one row, the lowest row that clears every bracketed span and its values. Before, each bracket stood right above its own steps, so two brackets stood at different heights, and the row changed with the width. Where the shared row stands below the top row, the empty band over it goes back to the plot. A single bracket is unchanged.
- To bring back the earlier look, set `bracketRow: "span"` on the waterfall.

### Added

- Waterfall option `bracketRow`: `"shared"` (default) or `"span"`.
