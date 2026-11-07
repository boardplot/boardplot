### Changed

- A column value under a reference tick that sits just over the column's end prints inside the column's end. Before, it moved above the tick, where it read as the plan's value. A pin brings back the old seat: `{ "labelPlacements": { "point:<series>:<category>": "outsideTopShifted" } }`.
- A callout, a note and a delta on the same column stack straight above it, over a reference tick, without leaders. Before, the first took the seat above and the others moved beside the column on an S-shaped leader, or were hidden. `preferSide: "left"` (or `"right"`) on a callout brings back the seat beside the column.
- A reference value beside its tick no longer stands over a neighbouring column, where it read as that column's plan. Where only such a seat was free, the value now goes to the notes.
