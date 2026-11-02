### Added

- Unit-only number formats such as `$M`, `€bn`, `%` and `x` choose precision from the field's data. Spreadsheet number codes translate to examples with warning `format-spreadsheet-code`.
- Direction glyphs and `±` act as signs. A trailing minus marks negatives. Integer examples such as `1st` print English ordinals, and `1.2E+06` prints scientific notation.

### Fixed

- Spaced magnitudes beside currencies scale values, including table cells under a shared unit. Currency affixes such as `USDm` and `€m` hold their divisor without printing a second magnitude word.
- Signed waterfall examples keep plus signs and direction glyphs on steps and omit them on totals. Locale grouping accepts the typed apostrophe and the narrow no-break space.

### Changed / may need action

- An example that writes a magnitude letter beside a currency (`1,234 EURk`, `1.2 €m`, `$1.2 k`) now divides the value by that magnitude, as `$1.2k` always did. To print the letters without scaling, write the unit in `options.unit` instead of the format.
- An example whose text ends in `E` or `e` with an exponent (`1E3`), in an ordinal (`1st`), or in `-`, or that holds ▲/▼ or `±`, now reads that text as notation or sign and no longer prints it on every value.
