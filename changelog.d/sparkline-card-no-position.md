### Changed

- The hover card of a `sparkline` point that has a label no longer prints a "Position" row. A point labelled "4 Jan" read "4 Jan / 18 / Position: 4". It now reads "4 Jan / 18". The keyboard card and the accessible text of the point drop the row too. No setting brings the row back. A sparkline without `labels` keeps the row, because its points have no other name.
