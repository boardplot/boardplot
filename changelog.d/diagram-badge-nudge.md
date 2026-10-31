### Fixed

- A diagram badge no longer refuses a chart that draws without it. A strategy house on a 960 by 540 pt slide with a number badge on each pillar header was refused with `diagram-node-label-unplaced` and `diagram-size-too-small`. A header too short for its label above a pill now keeps its full height, and the pill sits inside its left end. A badge that would leave the canvas moves inside it. A diagram taller than its canvas no longer names a badge as the cause. It names the nodes whose labels do not fit and the size to render at.
