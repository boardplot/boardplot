### Fixed

- A percent `options.format` such as `1.0%` now sets the decimals of the computed shares on a pie, a 100 % bar and a 100 % column. Before, these shares printed as whole percents whatever the format said. On a pie the format no longer lands on slice values that are counts or money: they print in the automatic format and the chart warns `percent-format-on-values`. A pie whose values are percents is unchanged.
