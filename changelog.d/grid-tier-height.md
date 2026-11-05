### Fixed

- A grid of tiers with an open height now keeps the height its parts need. A row-placed grid with long or rotated category names no longer squeezes a tier to a strip: a German-name slide grid at 480 px draws 437 px high instead of 385 px.
- A row-placed tier grid draws at an authored height where it used to refuse, when each tier still fits its own minimum. Slide and print step their type down first, as before.
- On a short canvas, a tier caption no longer prints over the subtitle, and a panel at its plot floor takes height from the panels with plot to spare. The grid warns with `grid-panel-too-short` when the tiers still do not fit. A repair gives way when the plain packing fits and keeps more values.
