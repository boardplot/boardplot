### Added

- A table can draw no head: `options.columnHeads: false` removes the head row and the group headings, with their height, rule and sticky offset, and no head widens a column. `{ "columnHeads": false }`. The SVG draws no head. React keeps a visually hidden head for assistive technology and warns `column-heads-sortable` when `sortable` is set, because the sort controls live in the head. A unit that only the head printed warns `column-heads-unit-hidden`. A dimswitch takes the same key, and its partial star leaves with the head while the note stays.
- A table column can align its head apart from its cells: `data.columns[].headAlign` takes the values of `align` and falls back to it. `{ "id": "fy25", "kind": "value", "align": "right", "headAlign": "left" }`.
