### Fixed

- A line name seated on its line now stands on a page-colour plate. Before, a halo only followed the glyphs, so the line showed through the letter gaps (a dot inside the "o" of North) and touched the ends of a name such as Central.
- A disclosed baseline tick with the value axis off now stays inside the plot margin. Before, a lone break tick such as "15%" started about 2 px from the left canvas edge.
- An anomaly corridor bound prints the precision it needs: a computed bound of 1,319.99 prints "1,320", not "1,320.0", on the chart and in the rule note. Column, line and combo charts share this.
- A shown line value axis no longer adds an off-grid tick at a cut baseline, such as 850 under 1,000 and 1,200 or 39 under 45. The break glyph still marks the cut, and the grid tick the off-grid one pushed out (40) prints again. An authored valueAxis.min still prints as set. Ticks that shared the extra decimal with the off-grid tick ("11.0") print whole again.
- When the last value carries a sign or magnitude unit because no subtitle prints it ("57k"), the value-axis ticks carry it too ("40k" to "60k"), so ticks and end label agree.
