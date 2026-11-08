### Changed

- Column: a plan tick (a reference series drawn as a tick) now draws behind its column and reaches up to 4 px past each side (2 px where a plan value beside it needs the room), in place of 2 px over the column on a page-colour band. The band cut a light line through every column above its plan, and a tick a few pixels under the column's top read as a second edge. A column short of its plan now prints its value inside its end at every distance to the tick, so every such column takes one seat. A tick beside its column (the integrated PY tick of a stacked column) is unchanged.
- To bring back the earlier look, tick and value seats alike, set `referenceTick: { position: "front" }` on the column chart (or on each column panel of a grid).

### Added

- Column option `referenceTick.position`: `"behind"` (default) or `"front"`.
