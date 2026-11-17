### Fixed

- The hover card of a waterfall total or subtotal printed its value three times. A total of 67.9 read `Total now · 67.9 · Start: 0 · End: 67.9`. A total rises from zero to its value, so its card now prints the name and the value: `Total now · 67.9`. A step keeps its Start and End, and so does each segment of a total that stacks segments.
