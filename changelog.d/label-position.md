### Added

- Bar value labels take one chart-wide `options.labelPosition`: `auto`, `center`, `insideEnd`, `insideBase` or `outsideEnd`. The inside end and base follow the bar edges farther from and nearer zero. Floating bridge steps fall back above the bar, or to the right on a horizontal bridge, when the requested seat is too small or blocked. Existing pins and automatic placement keep their meanings. Stacked variants and integrated variance support inside positions and refuse `outsideEnd`.
