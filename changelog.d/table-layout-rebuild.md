### Changed

- Wide tables lay out faster. Output is byte-identical. A table now measures its content once for each font and visible-column state instead of once per candidate width, stops a rejected width before drawing it, and copies its result once. Times per layout on a quiet Mac, before and after: the 26-column management report 91.29 ms to 44.81 ms at 878 px and 235.18 ms to 70.56 ms at 332 px, the monthly KPI table with sections 9.15 ms to 9.08 ms at 878 px and 80.82 ms to 29.50 ms at 332 px. A repeat layout on stable data still draws nothing.
