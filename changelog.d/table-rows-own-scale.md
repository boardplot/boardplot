### Fixed

- A table without formats no longer takes one magnitude for a column from its largest row when that magnitude prints smaller rows as bounds. Before, 17,600 orders beside $3.8M revenue printed `<0.1`, and their changes `n.m.`. Each unformatted row of such a column now prints at its own scale (`3.6M`, `17,000`, `2.3`), and its changes print their values. A table where one magnitude fits every row, and a table with authored formats or `options.magnitude`, prints as before.
