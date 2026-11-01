### Fixed

- An event `date` that is a category id, such as `"date": "tue"` on a column, combo or line chart with text categories, is still refused with `invalid-annotation` (or `invalid-options` in `options.annotations`). The fix now says to use `at` with a category id in place of `date`, and gives the first category as the example, such as `"at": "mon"`. A chart on a time axis keeps the old fix text.
