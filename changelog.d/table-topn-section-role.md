### Fixed

- A table with `topN` no longer folds a `kind: 'section'` row into Others. Section rows are group headings and keep their place, and `topN` ranks the rows inside each one. The React column sort now also keeps a result or driver row where it was authored, as `sort.categories` already did.
