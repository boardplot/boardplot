### Added

- A bar table with several segments (variant `panels`) prints each part's value inside its segment, in the ink that reads on the fill, where the text and 3 px of padding on each side fit. A part too narrow keeps no number. `options.segmentValues: false` turns it off. A panel whose format has more than one decimal, a row with a range and a one-segment table print end labels only, as before. Variant `cascade` refuses `segmentValues`. Rounded parts can miss the printed row sum by one step, and the notes list says so.

### Changed / may need action

- The default look of a multi-segment bar table changes: the bars now carry part values. To bring back the old look, set `segmentValues: false` in the options. No theme patch is needed.
