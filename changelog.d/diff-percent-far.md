### Added

- `delta` takes `mode`: `"absolute"` (the default) prints the value difference, `"relative"` the percent change from `vs`, for example `+36%`, and `"both"` the two together, `+149 (+36%)`. A percent mode with a `vs` of 0 warns `ref-zero`.
- `diff` takes `mode: "both"`: the value difference with the percent change from `from` beside it, `+149 (+36%)`. A `from` of 0 warns `ref-zero`.

### Changed

- On a column chart, a `diff` or `delta` between the totals of two columns that are not neighbours runs as the growth bracket over the columns, the form a `cagr` takes, with the difference on its arm. Before, a `diff` stood as an arrow in a free gap between the two columns with its number beside it. On a narrow canvas no gap was free, the arrow moved beside the last column, and its number was hidden (`label-hidden`, `values-in-note`). A `delta` printed its number over its column. `placement: "label"` brings back both older forms: `{ "kind": "diff", "from": "jan", "to": "dec", "placement": "label" }`.
