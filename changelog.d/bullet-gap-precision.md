### Fixed

- A bullet row without a format now prints its value and target at the precision that shows the gap between them. Before, the engine's precision could print two different numbers alike, so 0.108% against 0.112% read "0.11%", "0.11%" and "on target". It could also overstate the gap: 0.0994% against 0.0995% printed "0.099%", "0.100%" and a gap of −0.001pp, ten times the real −0.0001pp. Such a row now takes up to two more decimals. An authored format keeps its precision.
