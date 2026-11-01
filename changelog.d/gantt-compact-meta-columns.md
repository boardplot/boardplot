### Changed / may need action

- A gantt with `legend` left at its default leaves out two key entries that repeat what the page already says. The "Milestone" key goes when every milestone prints its own name. "Elapsed to today" goes when the today line prints its date. A 12-row plan with a one-line title then fits an 888 x 396 pt slide, where the key took 18 px more than the slide gave. To bring the old key back, set `legend: 'top'` (or `'bottom'` or `'right'`).
- A gantt keeps its metadata columns (Owner, Status) at the 90 px cell cap while the timeline keeps at least half the plot, in full and in compact mode. On a plot too narrow for that, such as a half-width slide, both modes cut the columns and give the width to the timeline.
- A gantt gives the milestone lane back to the timeline when only bar names, not milestone labels, ran into it. The timeline is then wider and the bar names sit inside it.

### Fixed

- A gantt on a slide whose height is tight no longer drops its metadata columns (Owner, Status) when the width allows them. Compact mode cut every cell to 30 px, so a height problem removed content that only needs width.
