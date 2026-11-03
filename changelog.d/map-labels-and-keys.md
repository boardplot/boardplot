### Fixed

- Choropleth region labels on the no-data hatch now take the same page-colour halo as labels on a state pattern, so the hatch lines no longer cross the text.
- A choropleth overlay glyph that is left off a crowded map is listed in the note in reader words: its label, its region name and its value, for example "DE 84% (Germany)". The note no longer repeats the accessible description.
- On choropleth and tile maps whose overlay key names tones, glyphs without a tone now have a key entry for their accent colour. Plain Harvey balls show the accent ring on the `overlayMeasure` entry. Other plain glyphs share one "Other" entry. Before, that colour had no key entry. No option brings back the old key.
