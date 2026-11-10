### Changed

- The React table takes its frame text from the same core function as the SVG frame. Its subtitle uses the core unit clause: no "in $M" after a measure that already names the unit, and the ratio wording ("Coverage ratio (×)"). A table without a subtitle prints its declared unit where the subtitle goes when no head, cell, note or source carries it, as the SVG does; `unitShown: true` turns that line off.
- The React table prints its notes within the target's line budget, as the SVG frame does: `notes.maxLines`, else the target default, counted in wrapped lines of its footer. The rest sit behind the pointer. Before, it printed every note unless `notes.maxLines` was set. Set `notes.maxLines` to a large number to print every note again.
- The React table's accessible summary counts the rows and columns on screen (expanded rows, shown columns, without the row an empty table draws) and no longer repeats the title. Before, it counted every row and column of the table and opened with the title and subtitle.

### Fixed

- The React table draws `**bold**` runs in its title, subtitle, notes and source as bold, instead of printing the markers.
- Under `footnotes: false` the React table no longer offers the table's own notes behind a pointer.
- A prepared table keeps its partial-total columns, so its partial-total note leaves with a hidden column.
- The React dimswitch warns `dimswitch-partial-note-off-frame` when the line budget moves the partial-period note behind the pointer, not only under the `info` placement.
