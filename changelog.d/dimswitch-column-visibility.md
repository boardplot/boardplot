### Added

- A dimswitch can leave out its Range, vs prior and vs plan columns: `options.columnVisibility` takes `{ "range": false, "pp": false, "pl": false }`, the same column ids as `options.encodings`. The label column and the period columns close up with no gap, and sticky columns count only the columns drawn. A note or claim about a left-out column does not print. The data still needs its range and prior periods, and `order` and `show` still read Range. Charts without this setting draw as before.
