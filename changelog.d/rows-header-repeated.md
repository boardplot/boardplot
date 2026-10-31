### Fixed

- A CSV with a repeated header no longer loses a column in silence. The first column keeps the name, the next reads as `name.1`, `name.2` and so on, and the render warns `rows-header-repeated`. Before, the name read the last column, so a chart drawn from such a file now shows the first column. Name `name.1` in `columns` to draw the other one.
