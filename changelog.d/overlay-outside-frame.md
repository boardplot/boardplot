### Fixed

- A choropleth overlay placed by longitude and latitude outside the map frame is no longer drawn off the canvas without a word. An `eu27` map with an overlay on Madeira put its glyph at x=-69 on a 720 px canvas, and only the label stub showed at the left edge. The overlay now moves to the note list like a crowded glyph, and the render warns `overlay-coordinate-outside-frame`. A map whose overlays all lie inside the frame is unchanged.
