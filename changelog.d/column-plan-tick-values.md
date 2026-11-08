### Changed

- A column value under a reference tick that sits just over the column's end prints inside the column's end. Before, it moved above the tick, where it read as the plan's value. A pin brings back the old seat: `{ "labelPlacements": { "point:<series>:<category>": "outsideTopShifted" } }`.
- A callout, a note or a delta on a column stands straight above it, over the column's printed value and over a reference tick, without a leader. Two or more on one column stack there. Before, a note over a column whose value printed above it moved beside the column on an S-shaped leader, and a second note on the same column went beside it too or was hidden. `preferSide: "left"` (or `"right"`) on a callout brings back the seat beside the column.
- A reference value beside its tick no longer stands over a neighbouring column, where it read as that column's plan. Where only such a seat was free, the value now goes to the notes.
