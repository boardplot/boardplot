### Changed / may need action

- A framed sparkline (title, subtitle or source) with `valueLabel: 'last'` now names more of its numbers. Next to the last value and the high it prints the low (dot and muted value under the point, with one label row reserved under the line), the first value (dot and muted value above the point on a falling line, under it on a rising one) and the value of the `reference` line, muted, in the column of the last value and level with the dashed line. The reference value steps away from the last value when the two meet. The low is skipped when it is the last point. The first value is skipped when it is the high or the low. The low and the first value print only where the high prints: not when the last point is the high, and not when the line band has no room. A bare sparkline is unchanged.
  - Old look: set `valueLabel: 'last-and-high'`, a new value that keeps the last value and the high only.
- `valueLabel` accepts `'last-and-high'`.
