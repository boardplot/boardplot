### Fixed

- `anchors.baselines` on a grid now aligns baselines only between panels that cover the same rows: `"all"` aligns as `"row"` does, and `"column"` aligns nothing, because stacked plots do not share a baseline. With `"column"`, and with `"all"` over more than one row, `render` and `measure` could refuse the grid, run out of memory or name a size at which it did not draw. With `"all"`, a panel that spans rows no longer aligns with a panel that covers only some of those rows.
