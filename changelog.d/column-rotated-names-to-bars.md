### Changed

- A column chart whose category names would be cut on the rotated 45° row now draws as horizontal bars, as it already did when the names could not rotate at all. The same conditions apply: an open height or a pinned height that holds every row, and only settings a bar draws as a column does. Before, every rotated name was cut with an ellipsis and kept its full text in the SVG title only. To keep the column, pin a height that cannot hold one row per name, or widen the canvas.
