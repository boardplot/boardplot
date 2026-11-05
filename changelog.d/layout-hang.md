### Fixed

- A gantt anchor offset of millions of days no longer holds a draw: the calendar head holds at most one period per pixel of the chart width.
- A very wide table column gives way in whole rounds, so a width such as 1,000,000,000 no longer holds a draw.
- A heatmap callout or note with empty text no longer ends the process. A callout or note with no words, headline or glyph prints no words and keeps its arrow or leader, on every type, with the warning `annotation-empty`.
- An oversized `xAxis.tickStep` on a time axis draws at once. A step that is too long or too dense for the range warns with `x-ticks-empty`. An hour, minute, second or millisecond step longer than a day, over a range with more days than the plot has pixels, gives way to the automatic ticks with the warning `x-tick-step-ignored`.
- A tree table with a `rung` of 9007199254740991 refuses at once at a fixed width, and no longer holds a draw or a measure.
