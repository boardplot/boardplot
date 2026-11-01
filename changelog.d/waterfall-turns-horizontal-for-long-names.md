### Changed / may need action

- A waterfall without an authored `variant` now turns horizontal when its step names would rotate, shorten or drop in the vertical bridge. The names then read upright and whole in a column left of the bars. The bridge turns only when the horizontal one draws without a new finding, fits the size (a pinned height too), and the spec has no cases and no annotations. Before, such a bridge drew rotated, cut names and the engine only warned. To bring back the old look, set `options.variant` to `"vertical"`.
