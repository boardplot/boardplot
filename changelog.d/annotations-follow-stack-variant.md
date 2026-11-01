### Fixed

- A column or bar chart in the `stacked100` variant no longer draws a difference arrow or a total growth bracket over its equal 100% columns. It drops the annotation and warns `annotation-unsupported-stacked100` with a fix. A growth bracket of one series keeps its own rate.
- A numeric `valueLine` at or beyond the 0 or 100 end of a `stacked100` axis is dropped with the warning `valueline-unsupported-stacked100`, so a data-unit value is no longer printed as "100%". A numeric `valueLine` strictly inside the axis stays and warns `valueline-percent-stacked100`, because it can be a valid share target.
