### Fixed

- A React table head no longer splits a word across two lines ("SHAR" / "E") when the browser draws it slightly wider than the SVG layout measured. Heads break at spaces only, as in the SVG. A sortable head keeps its current wrapping.
