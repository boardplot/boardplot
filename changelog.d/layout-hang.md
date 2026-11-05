### Fixed

- A gantt anchor offset of millions of days no longer holds a draw: the calendar head holds at most one period per pixel of the chart width.
- A very wide table column gives way in whole rounds, so a width such as 1,000,000,000 no longer holds a draw.
- A heatmap callout or note with empty text no longer ends the process. A callout or note with no words, headline or glyph draws nothing, on every type, with the warning `annotation-empty`.
- An oversized `xAxis.tickStep` on a time axis draws at once. A step that leaves no tick in the range warns with `x-ticks-empty`.
