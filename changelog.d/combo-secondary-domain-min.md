### Fixed

- A combo with a pinned `secondaryAxis.domain` that starts above zero now keeps that start. Before, the right axis was pulled back to zero, so a domain of `[30, 50]` drew ticks at 0, 25 and 50. Data below the pinned minimum still widen the axis. A secondary area series still keeps zero in the domain, because it fills down to zero.
