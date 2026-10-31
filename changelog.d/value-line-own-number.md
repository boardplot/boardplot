### Fixed

- A reference line prints its value unless its name holds that same number. The check matched digits inside other numbers, so a line at 20 named `Improve from -20` or `Top 120` printed no value. They now print `Improve from -20: 20` and `Top 120: 20`.
