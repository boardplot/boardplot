### Fixed

- The size that `measure` advises in a `table-tight-spacing` or `plot-under-floor` patch now holds: the chart drawn at that size does not warn again. A tight-spacing patch names no height where the caller left the height open, and `measure` lays the table out at the advised size until it stops tightening. Plot advice for a pinned height that moves asked notes (`methodNote`, `notes.placement`) to the notes list is measured with those notes, as the advised height draws them.
