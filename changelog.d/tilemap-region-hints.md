### Fixed

- Tilemap: an unknown region id names its repair. On a pack of countries an ISO 3166 code resolves through the world pack, so `DEU` on the europe pack answers "Did you mean 'DE'?", and a country the pack leaves out, such as `US`, names the world pack. Other ids get the nearest spelling, as on a choropleth. Before, the tilemap gave no hint.
- Tilemap and choropleth: a map whose listed regions are all unknown is refused with "none of the 3 listed regions is in tile pack 'europe', starting with 'DEU'" at `/data/regions/0/id`. Before, the refusal said the first region "was left out", which read as a partial map, and its path was empty.
