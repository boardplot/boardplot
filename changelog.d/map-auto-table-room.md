### Fixed

- On a canvas with a fixed height, a choropleth's automatic value table goes under the map only when the map keeps its full natural height. Before, the table could shrink the map to a thumbnail although the map alone printed every value. When the map without the table loses no value, the table is now left out, as the `valueTable` reference describes.
