### Changed

- German text now prints German number marks by default. With `options.locale.language` set to `de`, `de-DE` or `de-AT`, a chart prints `1.234,5` instead of `1,234.5`, in labels, axes, tables, notes and the accessible description. `de-CH` and `de-LI` print `1'234.5`. Every other language keeps `1,234.5`. An authored `locale.decimal` or `locale.thousands` still wins per key. To bring back the old look for German text, set `options.locale` to `{ decimal: '.', thousands: ',' }`. In React, pass `locale={{ language: 'de', decimal: '.', thousands: ',' }}` to the theme provider.
