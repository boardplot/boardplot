### Fixed

- `render --quiet` and a repeated MCP render no longer lay a chart out a second time for a design advice they do not print (the direct-label advice of a line chart, the horizontal advice of a waterfall). The answers are the same; the render does half the layouts for such a chart.
