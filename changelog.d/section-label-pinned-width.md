### Fixed

- A React table section label reads across its empty row under `stickyLabels`. Before, a theme with `table.blockRule: 'rule'`, the default look among them, fitted the label to the pinned columns, so "ADVERTISING" printed as "ADVERTI…" beside a row of empty cells. The label now wraps and cuts only at the table's end, as on the SVG.
