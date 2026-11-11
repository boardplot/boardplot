### Fixed

- A stack with one series now records a share exactly where it prints one. A 100% column, bar or area chart, and a plain stack with `shareLabels` or a `percent` segment label, printed `100%` on each segment, but the record held only the raw value and no share, so the hover card, the accessible text and `reading` could not tie the printed number to a source. A chart that prints no share on the mark, such as a plain stack without share labels or a grouped bar chart with only `valueAxis.percent`, still records none.
