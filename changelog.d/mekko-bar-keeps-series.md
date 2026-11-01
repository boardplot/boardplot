### Fixed

- A mekko with `variant: "bar"` and several data series no longer keeps only the first series. A cost chart with Labor and Material drew Labor alone, and the average line read 27.9 where the stacks total 52.8. The chart now draws every data series as stacked columns and warns `bar-mekko-extra-series`, with the fix: give one data series, or mark the others `role: "reference"`. A bar mekko with one data series is unchanged.
