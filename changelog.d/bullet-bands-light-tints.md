### Changed / may need action

- A bullet now paints its qualitative bands in the light ladder on every row, whatever the row count. Before, rows that did not print their band names stepped the bands 0.12 lightness apart, so from five rows on the worst band was the heaviest ink on the page (`#7a8795` on the default theme) and the navy bar sank into it, while four named rows drew a lighter ladder. The bands now step 0.06 apart from a good end 0.06 from the page (`#b9c2ca`, `#cfd6dd`, `#e6ecf0` for three bands on the default theme), so the bar stays the darkest mark and no longer needs its outline on the darkest band.
- A bullet band with a tone now paints its tone's fill washed toward the page, as the `percentOfTarget` scale already does with its good band. Before, a toned band drew the full fill, so a spend corridor that was on plan showed most of its row in solid red. Good sits 0.13 lightness from the page (`#b2e0cd` on the default theme, was `#0FA063`), warn 0.11, bad 0.09 (`#f8d8d8`, was `#E0524E`) and neutral 0.15, so a wide off-plan zone stays pale and good and bad differ in lightness. An attainment band on a bullet and its key wash the same way. The colours are decided in the theme the chart is painted in, so a dark theme washes toward its dark page.
- To bring back the old look, set the theme override `{ "marks": { "bulletBandFill": "full" } }`.

### Added

- Theme field `marks.bulletBandFill`: `'light'` (default) or `'full'`. `'full'` paints a bullet's toned bands and attainment band in `color.goodFill`, `color.warnFill`, `color.badFill` and `color.neutralMark` as they are, and steps the band ladder 0.12 apart on rows that do not print their band names. The fixture `two-sided-spend-full-fill` shows it.
