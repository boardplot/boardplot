### Fixed

- A table parent over rows that differ only in decimals now keeps its total. Rows formatted `$1.2m` and `$1.23m` made the parent print a dash with no warning, though one format would sum them. The parent now adds rows that share prefix, suffix and magnitude, whatever their decimals. Rows in another unit or magnitude, such as `$1.2m` and `$500k`, still do not add. `fitFormats` no longer drops a parent total by lifting the decimals of one row.
