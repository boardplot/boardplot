### Fixed

- A 100% bar or column prints its shares at a percent `series[].format` that every series sets ("51.2%"), as it does for a percent `options.format`. The series format was ignored and the shares printed whole ("51%").
