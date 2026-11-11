### Fixed

- Annotations written at a chart's top level, or at a grid panel's top level, now meet the same chart-type rules as `options.annotations`: a gantt badge label longer than 3 characters, gantt event `items`, a badge on column, combo or line, and duplicate annotation ids are refused at the authored path. The fix of an over-long badge label now switches `labelPlacement` to `'top'` instead of removing the label.
