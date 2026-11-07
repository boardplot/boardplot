### Added

- Theme key `marks.arrow` sets the look of every annotation arrow: `head`, `headWidth`, `stroke`, `tipGap`, `tailGap` and `minShaft` in px, and `style`. For example `{ "marks": { "arrow": { "head": 10, "tipGap": 8 } } }`.
- A drawn `arrow` whose shaft is shorter than 24 px warns `arrow-short`. A callout with `arrow: true` that finds no seat with room for a 24 px shaft draws without the arrow and warns `callout-arrow-no-room`.
- A callout with `arrow: true` can also stand over or under its point, so `preferSide: "above"` or `"below"` keeps its arrow.

### Changed

- Every annotation arrow follows one standard: a drawn arrow, a callout arrow, a CAGR bracket and growth arrow, a difference, a link, a gap bracket and a band bracket. The head is filled, 8 px long and 7 px wide. The shaft stays the thin `stroke.rule` line; `marks.arrow.stroke` sets its width, for example `1.5` for a shaft as heavy as the data marks. An arrow to a data point stops 6 px off its marker's edge, and its tail starts 4 px off its text. A callout arrow seats its text at least 24 px of shaft from its point, a difference from a line point starts 6 px off that point's marker, and a CAGR bracket keeps legs of at least 12 px of shaft under the head, so a chart with a CAGR bracket can give its plot a little less height. A difference or bracket still touches its level guide. Before, heads were 4 to 10 px by kind (callout 4, link, bracket and difference 5, drawn arrow 6, growth arrow 10), a tip sat on its point and no shaft had a minimum. The theme patch `{ "marks": { "arrow": { "style": "compact" } } }` brings back that look.
