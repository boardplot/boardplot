### Fixed

- `boardplot fonts build` records the typographic family (name ID 16) of a face when the font has one, so the weight variants of one family (for example Demi Bold and Heavy) are one family in the tables, not one family per weight. Fonts without that name keep the legacy family name.
