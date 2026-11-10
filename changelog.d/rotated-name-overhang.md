### Fixed

- `measure()` no longer throws "bandScale range must contain finite ascending values" for a narrow grid of column panels with long category names. A rotated first name could ask for more room on the left than the panel's plot had, and the plot width went below zero. The room a rotated name takes now leaves the plot at least 10 px, as the value axis does. Column, combo, line, variance and waterfall share this rule. `render` drew the same spec because it lays out only the asked width, while `measure()` also checks the chart at its minimum width.
