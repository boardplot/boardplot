### Fixed

- A gantt keeps every row name when its names wrap to two lines. Rows kept a 40 px pitch, so on a 12-row slide plan every second name lost its seat and dropped from the chart. A row now takes the height its wrapped name needs. On a fixed canvas the rows shrink together but never below that height, and the minimum height is the sum of those row heights. A canvas that is too short for the names is refused with the height it needs. That minimum counts the name, its sublabel and one gap to the next name for each row.
