### Added

- A live chart with `notes.pointer: false` that leaves author notes out of its footer warns `notes-left-out`. The warning counts the notes, names the `notes.maxLines` that prints them, and carries a patch that removes `notes.pointer: false`. Before, the notes appeared nowhere and `onWarnings` was empty. The React table now also reports its footer's own warnings, as the SVG table does. Author notes of a kind that `notes.show` switches off do not count. Static output prints every note and stays silent.
