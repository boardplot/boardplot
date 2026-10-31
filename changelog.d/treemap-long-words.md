### Fixed

- A treemap tile name with two words too long for the tile now draws on the tile. Only one word could be hyphenated, so a name such as `Wolkenkratzerfensterputzer Regenbogenfarbenmischer und Sonnenschirme` lost its label on a narrow tile and showed only in the notes. Each over-long word is now hyphenated, and each break allows one more line. Names that fit before are unchanged.
