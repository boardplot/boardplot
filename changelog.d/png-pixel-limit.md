### Fixed

- A PNG with a huge canvas no longer kills the CLI or the MCP server. A spec with a 1000000 x 1000000 px canvas made the rasterizer abort the whole process (CLI exit 134, MCP server gone on SIGABRT). A PNG above 100 million pixels (width x height x scale squared) is now refused with `png-too-large`, and the fix is to draw the SVG, lower `scale` or shrink the canvas. An 8000 x 8000 px canvas at scale 1 still draws. The limit is listed as `limits.pngPixelsMax` in `boardplot_list`. SVG output is unchanged.
