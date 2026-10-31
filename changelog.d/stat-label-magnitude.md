### Fixed

- An average, median or anomaly bound under a scaled format keeps the decimals it needs. On a column, bar, line or combo chart with format `1M`, an average of 1.25M printed as `1M`, because its decimals were counted on 1,250,000 and not on 1.25. The label now counts them at the printed scale and shows `1.3M`, and `1.25M` under a format with two decimals. Charts with a plain or percent format are unchanged.
