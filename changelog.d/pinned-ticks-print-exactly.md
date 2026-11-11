### Fixed

- A pinned combo secondary range that no round step divides puts its ticks on round values its tick format prints exactly ("1.0, 1.5, 2.0, 2.5, 3.0" over 1.0–3.2 at "0.0"). The ticks fell at 1.55 and 2.65 and printed unevenly as "1.6" and "2.7". An even division whose ticks print exactly keeps its rows.
