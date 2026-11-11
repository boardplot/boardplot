### Fixed

- A table row with `scale: "count"` or `scale: "percent"` keeps its own format under `options.magnitude: "thousand"` or `"million"`: a Users row in `1.23M` prints `5.51M`, not `5,505` beside a `k` label. Money and per-unit rows still follow the forced scale.
