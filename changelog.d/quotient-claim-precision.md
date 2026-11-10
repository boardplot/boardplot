### Fixed

- A percent change in the claim records now keeps its own precision when its operands are large. Before, the claim was cleaned at the size of its operands, so a KPI of $4.82T against $4.31T recorded a change of `10` while the card printed `+11.8%`, and a table change of −2.87% recorded `−3`. The same applied to a table `div` calc and to the relative `diff`, `cagr` and attainment annotations. The SVG is unchanged.
