### Changed / may need action

- A KPI card with a percent format compares in percentage points by default. `delta` and `compare` without a `mode` print the absolute change: a churn rate of 3.8% against 3.1% reads `+0.7pp vs PY`, not `+22.6% vs PY`, and a compare line reads `−2.4pp`, not `−2.4% (−2.4pp)`. A set `mode` still wins. The old defaults were `relative` for `delta` and `both` for `compare`. To keep the old look, set them on the card: `"delta": { "vs": 3.1, "mode": "relative" }` and `"compare": [{ "vs": 100, "label": "Plan", "mode": "both" }]`.

### Fixed

- A KPI card no longer prints a percent change when the value and its reference are on opposite sides of zero. A value of −42.5 against a plan of +18.2 printed `−333.5% vs PL`. It now prints the absolute change, `−60.7 vs PL`, and warns `sign-change`, in `delta` and `compare`, as a zero or negative reference already does. The record keeps `deltaPct` empty for such a change and sets `state: 'sign-change'`. No setting brings back the percent: an explicit `relative` or `both` mode is overruled as for a negative reference.
