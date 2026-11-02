### Fixed

- On a `stacked100` column, bar, Mekko or 100% area chart, an `abs` or `delta` annotation no longer takes the percent `format` that sets the printed shares. A 40-unit segment of 100 had printed `8.0%` for a value of 8, and a rise from 10 to 12 had printed `+2.0pp`. They now print `8` and `+2`, the values the annotation states, as they do without a `format`. A `valueLine` on the share axis keeps the percent format.
