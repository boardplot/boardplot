### Fixed

- A waterfall or PVM chart with `valueAxis.break: 'auto'` that finds no break to draw now keeps the height of a whole-axis bridge. Before, it lost the whole-axis plot allowance and drew about 100 px shorter at 720 px wide, such as `build-down`.
