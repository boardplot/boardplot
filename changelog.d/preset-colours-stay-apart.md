### Changed / may need action

- `studio`: the third series colour is an indigo blue. `color.series[2]` changes from `#C1553F` to `#3C50B4`. The old colour sat 5.7 OKLab steps from `bad` (`#C0373F`), so a third series read as a bad result. The new colour keeps clear of `bad`, `badFill`, the accent and every other series. To bring back the old look, patch the theme with `{ "color": { "series": ["#24564E", "#C68610", "#C1553F", "#609E93", "#7B82C7", "#84538F"] } }`.
