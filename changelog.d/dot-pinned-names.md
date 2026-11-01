### Fixed

- A dot, dumbbell or lollipop ranking on a pinned canvas no longer draws with most row names dropped. When the canvas was too short for the rows, the chart fell back to its hard minimum and hid names where they collided, yet counted as drawn. It now keeps that fallback only while every row name prints. Otherwise the chart steps its type size down as other charts do, and if that is not enough it refuses with `size-below-floor` and the height it needs.
