### Fixed

- A grouped column chart now shows a key above the plot when it ignores authored edge names under `legend: 'none'`. The key follows the automatic key policy of an unset legend, so it shrinks to fit. A fixed size that the key would make too small keeps the key-less chart, which reports `series-unexplained`, so nothing refuses that drew before. The `series-labels-ignored` warning remains. A chart with one data series keeps its key hidden, and stacked charts (also `valueAxis.percent`, which draws stacked100) and existing key positions keep their current behavior.
