### Changed

- Wide tables lay out faster. Output is byte-identical. A table now measures its content once for each font and visible-column state instead of once per candidate width, stops a rejected width before drawing it, and copies its result once. Times per layout on a quiet Mac, before and after: the 26-column management report 91.39 ms to 45.37 ms at 878 px and 231.40 ms to 71.02 ms at 332 px, the monthly KPI table with sections 9.21 ms to 9.09 ms at 878 px and 81.07 ms to 29.48 ms at 332 px. A repeat layout on stable data still draws nothing.
