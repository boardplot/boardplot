### Fixed

- A gantt over many years keeps dates in its calendar head. A 20-year span, or a 10-year span on a 400 px card, printed no year because the cells were too narrow for four digits. The year row now falls back to two digits (`10`, `11`). When no cell of the year row can hold a label, the render warns `gantt-calendar-unlabelled` and suggests a wider chart or a shorter span. A head that fits four digits is unchanged.
