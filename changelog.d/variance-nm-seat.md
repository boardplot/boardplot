### Fixed

- The `n.m.` text of a relative variance chart stays inside the plot. It was centred on its category and ran past the canvas edge when the category sat at the plot edge on a narrow chart, and the engine warned `text-clipped`. The text now moves inward until it fits, and breaks after `n.m.` when it is wider than the plot. A text that already fits keeps its place.
