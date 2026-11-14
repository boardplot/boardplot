### Fixed

- On a mekko chart, the warning `share-rounding-drift` named a sum at another precision than the labels where a format sets their decimals, on the chart (`format: "0.0%"`), on a series or on a cell: `99%` where the chart draws `33.3%` three times in a column. It now sums each share as its label prints it: `99.9%`.
