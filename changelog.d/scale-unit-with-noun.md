### Fixed

- A unit that names a scale before a noun, such as `"k visits"`, `"million tonnes"` or `"K users"`, now counts as a scaled unit, as `"$k"` and `"EUR m"` already did. Before, the engine added its own magnitude to large values: a Sankey flow of 260,000 under `"k visits"` printed `260k`, which read 1,000 times too large beside the unit. It now prints `260,000`.
