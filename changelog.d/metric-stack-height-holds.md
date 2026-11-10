### Fixed

- The `metric-stack-spacing` patch for `options.stack.heights` now raises every panel that is under its floor, so the patched metric stack draws. `measure` no longer refuses a chart that draws at the asked width because a wider type class, with larger type, refuses it: that width counts as one the chart does not draw at.
