### Added

- Dimswitch `columnVisibility` also takes period ids, so a table can show Range alone: `{ "columnVisibility": { "pp": false, "w1": false, "w2": false } }`. The label column stays. Hiding every value column draws the labels and warns `dimswitch-labels-only`.
- React `DimSwitchChart` reads `defaultColumnVisibility` as `columnVisibility`, the controlled prop wins, and an exported document keeps the state: `<DimSwitchChart defaultColumnVisibility={{ w1: false }} />`.
- Dimswitch `columnOverrides` sets `width`, `align`, `headAlign` and `label` on `label`, `range`, `pp`, `pl` and each period id: `{ "columnOverrides": { "label": { "label": "Metric" }, "w2": { "width": 120 } } }`. A width beats `widths`. The automatic card form sizes value tracks by content and warns `option-ignored` on such a width.
- Dimswitch `columnOrder` orders the `block` and `periods` blocks after the label: `{ "columnOrder": ["periods", "block"] }`. Only the label and leading block columns pin.

### Changed

- A dimswitch with `columnHeads: false` prints its partial Range or period note in the frame, or warns `dimswitch-partial-note-off-frame` where the frame has no place, also where the note would raise the height floor.
- A table's inline line follows the alignment of its column, on a column that is not right-aligned, in the SVG as in React.
