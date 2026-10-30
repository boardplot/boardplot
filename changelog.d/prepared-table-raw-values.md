### Fixed

- A `TableChart` drawn from a `prepareChart` snapshot keeps its arrows, the arrow key and its sparklines. The snapshot left out the raw values these marks are drawn from, so a prepared table printed the signed numbers alone and an empty sparkline cell.
