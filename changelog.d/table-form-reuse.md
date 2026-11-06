### Changed

- Tables and DimSwitch tables lay out faster, above all on repeat layouts. A table keeps its calculated cells, number formats and measured text between layouts, and a DimSwitch keeps its prepared form when Weekly changes is turned on or off.
- A DimSwitch keeps the kind of each note when the same data renders at a second width. Before, a disclosure note such as "Week 2 to date" could turn into a method note in the note list. `measure` now reports the larger, correct `minHeight` for a DimSwitch whose note wraps at a narrow width.
