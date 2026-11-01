### Fixed

- Diverging slope net scores and their changes now follow `options.format` in panel labels and accessible descriptions. A format of `1.0` now prints `+40.0 (+20.0)` instead of `+40 (+20)`.
- Under a percent format such as `0.0%`, the net score and its change print in percentage points (`+55.0pp (+17.0pp)`), because they are differences of two shares.
