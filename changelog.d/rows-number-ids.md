### Fixed

- JSON rows and inline rows take a number in a category, series or other text column, as CSV rows do. It reads as its text, so a `year` column of `2024` and `2025` draws two series instead of refusing `invalid-identity`.
