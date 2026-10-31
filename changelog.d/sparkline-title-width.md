### Fixed

- A sparkline with a title and no size is as wide as its title, up to the width of the target's canvas. It kept its 176 px card before, so on `slide` and `print` the title wrapped one word to a line and was cut. A sparkline with a short title stays 176 px wide, and a sized sparkline, a `kpi` and a `bullet` do not change.
