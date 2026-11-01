### Changed / may need action

- A canvas with a fixed height now gives its spare height to the rows of three chart types, so the chart no longer stops short of its source line.
  - `table`: the leaf rows take the spare height as air above and below the line, up to the theme's 16 px a side. Group and total rows keep their height, and the source stays at the bottom. The table reports the same minimum and natural height as before.
  - `bartable`: the row pitch grows up to 1.25 times its natural 28 px, and the bar thickens with it (14 px in a 28 px row, 20 px in a 35 px row). A theme that sets `space.barRow` keeps its own row.
  - `cohort` (`pure` and `stepped`): the rows grow up to 1.8 times their natural height. The period columns of `stepped` now share the width the label and size columns leave, as the `pure` columns do, instead of keeping their measured width.
  - Old look for `table`: `heightFill: 'none'`. Old look for `bartable`: `theme: { overrides: { space: { barRow: { pitch: 28, thickness: 14 } } } }`. A `cohort` canvas without spare height is unchanged, and a canvas with an open height is unchanged for all three.

### Added

- `table` has the option `heightFill`: `'rows'` (default) spreads the spare height of a fixed canvas over the leaf rows, and `'none'` keeps the rows at their natural height.
