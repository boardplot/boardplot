### Fixed

- A table whose column formats share a bare scale now keeps the currency of `options.unit`. A `1.2bn` format with `options.unit: 'EUR'` printed `Revenue in B` and left the currency out. The frame now reads `Revenue in EUR B`. A unit that already ends in the scale, such as `EUR bn`, prints as written. A unit that ends in another scale still gives the `table-unit-overridden` warning.
