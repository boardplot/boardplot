### Fixed

- A grouped column chart now shows a key above the plot when it ignores authored edge names under `legend: 'none'`. The key follows the automatic key policy of an unset legend, so it shrinks to fit and never refuses a fixed size that draws without it. The `series-labels-ignored` warning remains. A chart with one data series keeps its key hidden, and stacked charts and existing key positions keep their current behavior.
