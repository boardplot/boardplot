### Fixed

- A table cell key that is a near miss of a column id warns `cell-column-unknown`. A key such as `amunt` for a column `amount` used to drop its number with no word. The warning comes once per key, names the first row and how many more carry the key, offers the nearest column id, and carries a patch that renames the key when one row holds it. A key far from every column, or beside a column the row also fills, is data left out of the columns on purpose and stays quiet. The table draws as before.
