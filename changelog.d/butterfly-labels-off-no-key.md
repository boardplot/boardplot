### Fixed

- Butterfly charts with `labels: false` or `labels: { point: false }` no longer add a series key that repeats the pane headers and increases the chart height. An explicit `legend: 'top'` still draws the key. The automatic key remains when the pane headers are also hidden.
