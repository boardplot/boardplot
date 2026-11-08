### Changed

- On a column chart whose key names a reference series (a plan tick), a reference value that is too wide for the gap beside its column prints the number alone ("400", not "400 Plan"), for every value of that series. Before, at narrow widths such as 360 px, the named values found no seat and all went to the notes. `{ "labels": { "tick": ["absolute", "series"] } }` brings back the old text.
