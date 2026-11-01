### Added

- Sankey option `linkValue`: `'large'` (default) or `'none'`. A ribbon at least one line high prints its value at its arriving end, right aligned to the next bar, in the axis type size and the muted ink. Thinner ribbons print nothing. A value that would cover a node label is left out, and so is the only inflow of a node whose label prints the same count (with `nodeValue: 'share'` the count still prints).

### Changed / may need action

- Every sankey now prints flow values on its larger ribbons, so its SVG changes. To keep the old look, set `linkValue: 'none'`: only the node values print, as before.
