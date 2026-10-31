### Fixed

- `fitFormats` no longer rounds a figure of one significant digit to another digit. 80,000 printed 0.1 under ($M), 25% off, because the format `$1.23M` showed it as 0.08 with one digit and the shorter format kept one digit too. The column now keeps the decimals that print the figure within 5%, and it widens with the warning `table-column-widened` where those decimals do not fit.
