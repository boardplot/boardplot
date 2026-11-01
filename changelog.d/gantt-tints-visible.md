### Changed

- Gantt row and weekend shading now uses its own theme field, `surface.ganttRowTint`, with a default of `0.25`. The wash resolves from `color.others` in the active theme, including after a repaint. Table zebra shading keeps `surface.rowTint`. To restore the previous shading strength, set the theme override `{ "surface": { "ganttRowTint": 0.94 } }`. The Weekend key keeps its previous maximum wash of `0.8`.

### Fixed

- Gantt weekend shading now draws below the elapsed band, so weekends do not cut pale gaps into the past. The Weekend key uses the visible Gantt wash.
