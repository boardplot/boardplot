### Fixed

- A dense chart on the default slide or print canvas is no longer refused where the same canvas written out as a size draws. A 13-row bar with `target: "slide"` and no `size` said `size-below-floor`, while `size: { width: 888, height: 396, unit: "pt" }` drew it in compact mode. The default slide and print canvas is now a pinned canvas, so a chart that lacks room falls back to compact there. `belowMinimum: "refuse"` still refuses.
