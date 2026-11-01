### Changed / may need action

- On a canvas with a fixed height, the notes and the source line now stand right under the drawn content. Before, they stayed at the canvas bottom, and a chart that stopped short of its canvas left an empty band above the source (up to 360 px on a slide). The spare height now stays below the source line, at the bottom edge.
  - The notes, the source line, a map credit, the event key and a key under the plot move up together, to the usual gap under the lowest drawn mark (12 px below 1080 px canvas width, 14 px above, 10 px under a key below the plot, 8 px on a compact card). The canvas size, the plot and every mark stay where they were.
  - Charts that fill their canvas are unchanged to the byte. Nothing moves unless the empty band is more than 8 px larger than the usual gap. A canvas with an open height is unchanged. A panel inside a `grid` keeps its place, and the `grid` moves its own footer.
  - Per-chart row growth still comes first: the `heightFill` rows of `table`, `bartable` and `cohort` take the spare height before the footer moves.
  - Old look: set the theme patch `theme: { overrides: { space: { footerFollows: false } } }`. The notes and the source go back to the canvas bottom, with the empty band above them, at the same canvas size as before.

### Added

- The theme field `space.footerFollows` (default true). `false` keeps the notes, the source line and a key under the plot at the bottom of a canvas with a fixed height.
