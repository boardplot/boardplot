### Fixed

- A translucent fill in SVG output opens right in LibreOffice. A sankey flow and any other fill spelled as `#rrggbbaa` was written as an 8-digit hex colour, which LibreOffice paints as opaque black, so the flows and their labels could not be read. The SVG now writes a plain colour with `fill-opacity`. The look in browsers and in PNG stays the same.
