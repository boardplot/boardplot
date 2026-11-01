### Changed / may need action

- A gantt with `legend` left at its default leaves out two key entries that repeat what the page already says. The "Milestone" key goes when every milestone prints its own name. "Elapsed to today" goes when the today line prints its date. A 12-row plan with a one-line title then fits an 888 x 396 pt slide, where the key took 18 px more than the slide gave. To bring the old key back, set `legend: 'top'` (or `'bottom'` or `'right'`).

### Fixed

- A gantt on a slide whose height is tight no longer drops its metadata columns (Owner, Status) when the width allows them. Compact mode cut every cell to 30 px, so a height problem removed content that only needs width. Compact mode now keeps the 90 px cap and cuts the columns only when the timeline would fall under half the plot, as the stacked form does.
