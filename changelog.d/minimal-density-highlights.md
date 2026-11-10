### Fixed

- Under `labelDensity: "minimal"` a highlighted value inside a series now keeps its label, as minimal promises. Before, a highlighted interior value on a line, area, cohort curve, variance chart, heatmap, funnel, Marimekko, pie, scatter, gantt, dot, butterfly or combo chart dropped without a warning, while the highlighted ends kept theirs. A value row that falls back to its ends (for example with `pointLabelSide: "auto"`) also keeps its highlighted values.
