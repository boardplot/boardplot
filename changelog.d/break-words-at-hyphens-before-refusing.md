### Changed / may need action

- Treemap cell names step down to 10 pt (13.33 px) on a slide before a cell goes blank, where they stopped after three 1 px steps at about 15.67 px. The step search takes the largest size that reaches the best result. On a report or a dashboard the floor stays 11 px. To keep the old look, pin the label size with `textSize` (for example `textSize: 16` on a slide): a pinned size is drawn as given and does not step.
- A treemap name that is too wide for its cell breaks first at a hyphen it already has ("North-" / "Westmoor"). Only then does it break inside a word, now at a syllable edge instead of at the longest head that fits, with at least three letters on each side. A cut before a word ending ("stream-" / "ing") comes first, then a cut between consonants ("cus-" / "tomer"), then a cut before a single consonant after a vowel. The ladder no longer counts a break at an existing hyphen as a broken word.
- A diagram node label that would be cut is wrapped again with breaks after `_ - / .`, and the second result wins when it needs no cut. The strategy house, the issue tree, the hierarchy and the other diagram presets count the same lines when they set band and row heights. A strategy house with hyphenated names such as "North-Westmoor" or "Northumberland-Westmoreland" now draws at half a slide and on a 480 px card, where it was refused.
- A diagram label of two or more lines inside a centred node is now centred line by line. It was set flush left inside a centred block. Single-line labels are unchanged. There is no option for the old look. The lines of a node that is aligned to the start stay flush left.

### Fixed

- A treemap name wider than its cell no longer leaves the cell blank when a hyphen or syllable break fits it.
