### Fixed

- A table cell key that names no column warns `cell-column-unknown`. A key such as `amunt` for a column `amount` used to drop its number with no word. The warning names the row, offers the nearest column id and carries a patch that renames the key. The table draws as before.
