### Added

- The diagram `architecture` variant gains `data.inset`, a detail panel with large numbers (`kpis`) and short rows (`rows`) after a rule. It sits beside the exhibit from 800 px of plot width, and under it below that. The diagram chart now has a design card, and discovery names system architecture, data flow and trust boundaries.

### Changed

- Architecture layouts plan each width once per render, so they take about half the time.

### Fixed

- An architecture return label could sit closer to another line than to its own, which named the wrong line. The label now sits closer to its own line when a layout allows that. This can move a return edge to an outer corridor, as in the `marketing-pipeline` fixture.
- The `store` shape no longer shows a hole in its lid.
