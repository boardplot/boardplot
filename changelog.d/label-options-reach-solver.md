### Fixed

- `focus` now reaches the label solver on a histogram (its counts and bin edges) and on a grid metric stack. A focused label wins contested space there, as on the other types.
- A sparkline now reads `focus`, `labelDensity` and `labelPlacements`. Before, it read only `labelOffsets`: `labelDensity: "minimal"` kept the high, low and first values, and a pin could not hold a label.
