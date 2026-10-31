### Fixed

- A bar table no longer adds percentages, rates and multiples into its Total. Margins of 12.5%, 8% and 10% printed a Total of 30.5%, and a column in a `1.0x` format printed 9.0x. The Total is now empty where the column or panel format is a percentage, percentage points or a multiple, where `options.format` is one, or where the panel unit is `%`. A cascade keeps its sum. An authored `aggregate: "sum"` there still prints the sum and warns `aggregate-non-additive`. To bring back the old look, set `aggregate: "sum"` on the column or panel.
