### Added

- React: `onRowSelect(rowId, { row, event, columnId })` and `isRowSelectable(row, { collapsed })` on `BoardplotChart`, as `TableChart` takes them: a click in a table row or Enter or Space on its focused cell calls `onRowSelect`. Only a `table` spec (alias `tbl`) receives them; `BoardplotChart` passes them to no other chart type, so they never reach a chart's options. A `dimswitch` spec draws as SVG in `BoardplotChart` and takes no row pick; `DimSwitchChart` from `boardplot/react/dimswitch` keeps its own `onRowSelect`.
