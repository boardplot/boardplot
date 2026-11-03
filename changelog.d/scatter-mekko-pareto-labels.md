### Fixed

- Scatter points drawn on top of each other keep every name: the names stand around the whole clump, and a clump at the plot's edge stacks a second name over and under it (four clustered points kept only two names each).
- A scatter point with `marker: 'none'` prints its name on its own coordinates first, so the text marks where the point is instead of floating beside an empty spot.
- A bubble name sits only where its own bubble is clearly the nearest, also from the name's middle, so a name slid between two bubbles moves to a seat or a leader that reads as its own.
- A dense percent mekko names its narrow columns on up to three upper tiers, each name on a leader to its own column that passes clear of the names below it (three of ten columns had no name).
- Pareto cause names that stand vertical wrap onto two or three lines across their column before they are cut, so long names read whole where the column has room.
