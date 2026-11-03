### Fixed

- A box chart's hover card prints both ends of the quartile and whisker ranges with the unit and at the precision of the chart's labels ("$47.2k to $234.1k"). Before, only the upper end had the unit, and each end kept its raw precision ("47.225 to $234.05k").
- A bullet chart's hover card gives the gap between two percentages in points ("vs Target: −7pp (−8%)"), as the chart's gap column does. Before, it read "−7% (−8%)".
- A hover card prints its row names in full: names keep up to half the card, and a long value wraps beside them. A card whose name and value do not fit one line grows from 280 px to at most 320 px wide. Before, names were cut to 48 px ("Accou…", "Media…").
- The hover card names a value that the title alone does not say: a creative's own metric value ("Creative: 1.8%"), the segment of a split funnel stage ("Advanced: 2,100 leads") and the answer count of a Likert segment ("Responses: 100").
- A neutral Likert answer split across the centre line lights and outlines both halves on hover. Before, the outline of one half ran along the centre line through the shared label.
- A gantt item without a label reads as its row and what the mark is, in the key's words ("External interviews", "Overall span"). Before, the hover card showed the item id and the kind code ("interviews-span", "bracket").
- Value labels on dimmed marks take readable ink while another mark is hovered, also when the label belongs to a whole category (a column total) or names the mark's base colour (a gantt bar). Before, white labels stayed on the faded bars.
- Changed hover previews (both theme families): box, bullet, combo, creative, funnel, gantt, likert.
