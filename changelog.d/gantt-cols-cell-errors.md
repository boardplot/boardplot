### Fixed

- Gantt `rows[].cols`: a cell object's `tone` is optional, so `{ "text": "x" }` is valid and means the same as `"x"`. Before, it was refused with a missing-tone error.
- Schema errors of a union with a literal tag: when one branch fails on its own tag (a gantt task row checked against `kind: 'cadence'`) and another branch passed its tag and failed on a named field, only the second branch's errors are reported. Identical errors (same path and message) are reported once. Before, a task row with one bad item kind reported the item error plus a misleading "expected cadence" error, and a bad `cols` cell was reported twice. No golden changes.
