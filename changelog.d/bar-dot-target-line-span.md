### Fixed

- A `valueLine` on a bar or dot chart now follows its `from` and `to` as on a column chart. The span clips only a `tolerance` or `attainment` band, which covers the named rows; the line itself still crosses the whole plot.
  - With a `tolerance` or `attainment`: a `from` or `to` that names no category warns `bad-anchor`, and only one of `from` and `to` warns `valueline-scope-invalid`. The line is drawn without the band.
  - Without a `tolerance` or `attainment`: any `from` or `to`, also one that names no category or stands alone, warns `valueline-scope-authored-value` and the line is omitted. Bar and dot drew a full-length line without a warning before.
- Dot charts now draw a target's `tolerance` and `attainment` bands, behind the dots, the lines and the gridlines. An `attainment` without its own series reads the highlighted series, else the first, as column and bar do; a dumbbell reads its current dot. The value axis takes the whole tolerance band, and the line's label keeps the `%` of a percent chart.
- A bar chart's value axis widens to a tolerance or attainment line outside the data, and an axis break that would hide any such line is refused with `axis-break-invalid`, as on column.
