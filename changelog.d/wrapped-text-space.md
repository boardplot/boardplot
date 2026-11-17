### Fixed

- A text on two or more lines lost the space between its lines in the React components, where the SVG from the CLI kept it. A category label that wraps on the axis as `word one` over `word two`, and a hover card title that wraps, read `word oneword two` when a reader copied the text or a screen reader read it out. The React SVG now keeps the space between the lines, as the SVG from the CLI does, and reads `word one word two`. The drawing does not change.
