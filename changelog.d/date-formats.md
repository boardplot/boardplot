### Changed / may need action

- An unreadable time-axis format now warns `date-format-unknown` and uses default ticks instead of printing literal letters. Unreadable table date formats warn and keep the default `d MMM yyyy`. Ambiguous numeric examples read day first and warn `date-format-ambiguous`. A year in front keeps year/month/day.

### Added

- Time axes and table date columns share a reader for patterns and examples. Formats include long month names, year only, numeric dates, Excel lowercase months, moment-style year and day tokens, and `Q`, `QQ`, `QQQ` quarter tokens. `FY26` reads the calendar year and gives `date-format-fiscal-year` (info).

### Fixed

- A time format `Q1 2026` printed the same text on every tick, including ticks in 2027. It now follows each tick's quarter and year. `Jan 2026` no longer prints `JAMn 2026`. `mmm-yy`, `dd/mm/yyyy`, `'Q'Q yyyy` and `QQ yyyy` now read as date formats.
- Table date formats such as `30.09.2026`, `09/30/2026`, `Sep 30, 2026`, `September 2026`, `2026`, `FY26` and `dd.MM.yyyy` now control the cell text instead of silently using `30 Sep 2026`.
