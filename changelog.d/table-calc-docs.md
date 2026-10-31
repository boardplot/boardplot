### Fixed

- A table column calculation no longer promises cross-row refs it refuses. The description of `columns[].calc` now says that a `{ row }` or `{ row, previous: true }` ref is refused with `row-ref-in-column-calc` and belongs in `rows[].calc`. A `share` calculation without `of` now gives one error that names `of`, where it listed four errors about `op` and never named the missing field. Any union with literal tags and one branch that lacks only fields reports the same way.
