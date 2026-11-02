### Added

- Unit-only number formats such as `$M`, `€bn`, `%` and `x` choose precision from the field's data. Spreadsheet number codes translate to examples with warning `format-spreadsheet-code`.
- Direction glyphs and `±` act as signs. A trailing minus marks negatives. Integer examples such as `1st` print English ordinals, and `1.2E+06` prints scientific notation.

### Fixed

- Spaced magnitudes beside currencies scale values, including table cells under a shared unit. Currency affixes such as `USDm` and `€m` hold their divisor without printing a second magnitude word.
- Signed waterfall examples keep the plus on steps and omit it on totals. Locale grouping accepts the typed apostrophe and the narrow no-break space.
