### Fixed

- A long daily line with `window: { decimate: "none" }` keeps its axis readable: the month ticks the engine picks for a long day row thin to the labelled ones when they would sit closer than 2 px. 100,000 daily points drew about 3,300 ticks that merged into a solid bar. An authored `categoryAxis.dateTicks` keeps every tick as before.
