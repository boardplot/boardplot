### Fixed

- A hover card keeps clear of the chart's title, subtitle, notes, headers and legend. Before, a waffle's card covered the title and subtitle when the space beside the grid was too narrow.
- A funnel's hover card sits next to the hovered stage. Before, the row lanes that the funnel reserves for its own labels counted as drawn marks, so the card fled to the bottom corner.
- A dimension switch's hover card sits next to the hovered cell, as a table's card does. Before, the card had no anchor and sat in the bottom-left corner over a row name.
- When no seat leaves every label free, the hover card takes the seat that hides the fewest labels. Before, a football field card for the first row hid the high-end labels of three other rows; it now hides one.
- Changed hover previews (both theme families): bar, bullet, cohort, dimswitch, funnel, grid, heatmap, histogram, pie, variance, waffle.
