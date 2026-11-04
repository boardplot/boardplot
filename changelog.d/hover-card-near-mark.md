### Fixed

- A hover card stays next to the hovered mark. A clear seat more than 48 px from the mark counts only when no nearer seat is safe, and a nearby seat may hide labels of other records instead. Before, a tall card on a rising 12-column stacked chart sat in the chart's far corner, up to 319 px from the pointer, because no seat near the bar was clear of all text. The card still never hides the hovered record's own labels and never covers the pointer, and it keeps clear of the chart's title, notes, headers and legend where a seat allows it.
- Changed hover previews (both theme families): bartable, column, dot, heatmap, likert, line, mekko, pareto, pyramid, scatter, slope, status, table, tilemap.
