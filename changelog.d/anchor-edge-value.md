### Fixed

- Waterfall callouts, notes, absolute labels and deltas against a number on a step now read the step amount. A delta against another anchor, diff and CAGR keep reading the running level, so a delta and a diff between the same two anchors print the same number. Explicit start and end anchors keep their level values, and totals and subtotals keep their totals.
- An explicit total anchor without a series on a stacked area now reads the sum of the bands and sits at the top of the stack. String anchors keep reading the first drawn series, and anchors with a series keep reading that series.
