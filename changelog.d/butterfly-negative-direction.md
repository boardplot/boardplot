### Added

- Butterfly takes `negatives: 'direction' | 'magnitude'`. The default `'direction'` is described under Changed.

### Changed / may need action

- A butterfly with a negative value gives each pane a zero line. Positive bars run outward from it and negative bars run toward the category names, on one shared scale and in the pane's full colour. The `butterfly-negative` warning and the note that explained the lighter bar are gone, because the direction now carries the sign. Old look: set `negatives: 'magnitude'`, which draws the bar length of the absolute value outward in a lighter tint and keeps the warning and the note. The pyramid keeps the old look.
- A butterfly with `sharedScale: false` draws a thin value axis under each pane, with about four round ticks in the pane's own number format. Old look: set `labels: { tick: false }`.
- A butterfly prints the not-applicable mark (`n/a`, German `k. A.`) in the muted text colour at the pane's zero line where a value is blank, so a blank no longer reads as zero. Old look: set `strings: { notApplicable: '' }`, or turn the value labels off with `labels: { point: false }`.
