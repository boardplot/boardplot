### Fixed

- A table column that prints no figure (every cell open, missing, `null`, suppressed or text) no longer names a unit in its head. Under `options.magnitude` such a column read "OCT (M)" while the filled columns beside it, whose rows name the unit, read "SEP". Such a column also no longer decides whether the shared unit moves to the frame's unit line: a table with one empty column in another unit hoists "in $k" as it does without that column.
