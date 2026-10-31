### Fixed

- `fitFormats` no longer prints a small figure as zero when the fitted format has three decimals. The format it wrote for a lifted cell, `$1.234M`, read back as a thousands group, so 3,000 in a `$1.23M` column printed `$0M`. The format now reads `$0.234M`, and the cell prints `$0.003M`.
