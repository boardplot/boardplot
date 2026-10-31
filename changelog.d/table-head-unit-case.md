### Fixed

- A table column head and a column-group heading keep the text after the last comma as written, on the SVG and in the React grid. `Power,mW` printed as `POWER,MW`, which reads as megawatts. It now prints `POWER,mW`, as the bar table and the cohort heads already did. The grid's group heading carries its capitals in the text, no longer through CSS `text-transform`.
