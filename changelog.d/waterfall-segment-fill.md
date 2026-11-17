### Fixed

- A waterfall segment's `value.fill` painted only its own bar. The key showed the theme colour for that segment, and a closing total that stacks the segments of its steps painted them in theme colours, so the key, the steps and the total disagreed. A segment id now keeps one colour everywhere: with `{ "id": "north", "value": { "number": 12, "fill": "#1F6F8B" } }` on each step, the key swatch and the North part of the closing total are `#1F6F8B` too. When one segment id gets different fills, the first one paints every bar and the chart warns `segment-identity-mismatch` once.
