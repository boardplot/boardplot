### Fixed

- A line series with a negative base no longer flips under `rebase100`. A series from -50 to 80 drew 100, -120, -140, -160, because the values were divided by the negative base. An index to 100 has no meaning on a base at or below zero, so the series is now left out with a `rebase-base-invalid` warning, as for a zero or missing base. The key now reads "zero or negative base" and the schema text says so.
