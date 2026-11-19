### Fixed

- A chart with a set height that drew just under 720 px or 1080 px was refused just over it. The text steps up a size class at those widths, and the larger text needed more height than the chart had: a heatmap at 405 px high drew at 700 px wide and was refused from 720 px. A set height that the larger text does not fit now draws in the smaller text class, as a width that is too narrow for the larger text already does. A chart that fits in its own class keeps its look, and a height too small for the smallest text is refused as before.
