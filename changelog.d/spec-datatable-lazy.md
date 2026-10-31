### Fixed

- `BoardplotChart` no longer loads the accessible data table into every chart. The table code and the record code behind it were part of the first load of each spec chart, also with `options.a11y.table` off, about 43 kB gzip. They now load only for a spec that sets `options.a11y.table`, and the chart waits for them, so its first draw includes the table as before. The initial entry of `boardplot/react/spec` drops from about 237 kB to about 194 kB gzip.
