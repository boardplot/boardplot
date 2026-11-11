### Fixed

- A React table's column toggle buttons are at least 24 px high, the WCAG 2.5.8 target size. Before, they took their height from their text and padding, 21.6 px at 390 px width. To bring back the old look, set `min-height: 0` on `.bp-table .bp-col-toggle`.
