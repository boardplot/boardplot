### Fixed

- On a mekko chart under a percent format such as `format: "0.0%"`, the warning `share-rounding-drift` named a sum at another precision than the labels: `99%` where the chart draws `33.3%` three times in a column. It now names the sum of the drawn shares: `99.9%`.
