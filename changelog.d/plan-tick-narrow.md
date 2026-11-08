### Changed

- On a column chart with one reference series (a plan tick) that the key names, a reference value that is too wide for the gap beside its column prints the number alone ("400", not "400 Plan"), for every value of that series. Before, at narrow widths such as 360 px, the named values found no seat and all went to the notes. `{ "labels": { "tick": ["absolute", "series"] } }` brings back the old text.
- A reference value no longer takes the seat left of its tick when the column to its left has a value of the same series, where it read as that column's value.
