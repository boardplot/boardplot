### Changed

- Tables and DimSwitch charts lay out faster. A DimSwitch keeps its prepared form when Weekly changes is turned on or off, and repeated layouts reuse heading and body text measurements.
- A DimSwitch keeps the kind of each note when the same data renders at a second width. Before, a disclosure note such as "Week 2 to date" could turn into a method note in the note list. `measure` now reports the larger, correct `minHeight` for a DimSwitch whose note wraps at a narrow width.
