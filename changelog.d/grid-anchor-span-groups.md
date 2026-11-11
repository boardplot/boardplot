### Fixed

- A grid anchor (`anchors.plotEdges`, `anchors.categories` or `anchors.baselines`) now aligns only panels that cover the same columns, or for a row anchor the same rows. Before, it grouped panels by their first track, so a panel that spanned several columns or rows was pulled into the plot of a one-track panel beside it: a full-width status matrix shrank into the first column, lost its labels, and the grid was refused at widths wider than one it drew at. The spanning panel now keeps its whole plot, and a `grid-anchor-incompatible` warning names it at every width.
