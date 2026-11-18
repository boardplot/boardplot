### Fixed

- A `valueLine` with a numeric `value` on a bar or dot chart now follows its `from` and `to` as on a column chart. The span clips only a `tolerance` or `attainment` band, which covers the named rows; the line itself still crosses the whole plot.
  - A `tolerance` band with only one of `from` and `to` warns `valueline-scope-invalid`. With a `from` or `to` that names no category it warns `bad-anchor`. The line is drawn without the band.
  - An `attainment` band warns `bad-anchor` in both cases, and the line is drawn without the fill. A line with both bands gives the warning of each.
  - A `from` or `to` with neither band, or a `seriesId`, warns `valueline-scope-authored-value`, and the line is omitted. Bar and dot drew a full-length line without a warning before.
  - A measured mean (`value: "mean"`, or no `value`) with a `from`, `to` or `seriesId` is refused with `valueline-scope-unsupported` on bar, dot and column, as before.
- Dot charts now draw a target's `tolerance` and `attainment` bands, behind the dots, the lines and the gridlines. An `attainment` without its own series reads the highlighted series, else the first, as column and bar do; a dumbbell reads its current dot. The line's label keeps the `%` of a percent chart.
- The value axis of a bar or dot chart holds each tolerance band it draws whole, also the band of a measured mean, so a band ends where its label says. A band that is not drawn leaves the axis as it is. On a bar chart, a band wholly outside the axis is still omitted with `band-bounds-offscale`, and a 100% axis still ends at 100.
- A bar chart's value axis widens to a tolerance or attainment line outside the data. An axis break that would hide an authored target value is refused with `axis-break-invalid`, as on column.
