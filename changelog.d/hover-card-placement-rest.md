### Fixed

- A hover card keeps clear of the chart's title, subtitle, notes, headers and legend where a seat allows it. A waffle's card at 480 and 560 px wide no longer covers the title and subtitle when the space beside the grid is too narrow.
- A funnel's hover card sits next to the hovered stage. Before, the row lanes that the funnel reserves for its own labels counted as drawn marks, so the card moved far down the chart.
- When no seat leaves every label free, the hover card takes the seat that hides the fewest labels, and only when it hides no label the earlier seat left readable. A football field's card for the first row hides one other row's label instead of two.
