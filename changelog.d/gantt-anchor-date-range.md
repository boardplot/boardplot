### Fixed

- A gantt `anchor.offsetDays` that moves an item outside the dates a spec can name (0000-01-01 to 9999-12-31) is refused with `invalid-date` at that field and says to use a smaller offset. It was refused as `unserializable-chart` naming a NaN scene value, and an offset that stayed inside what the date arithmetic holds drew a calendar past the year 9999.
