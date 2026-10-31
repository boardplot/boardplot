### Fixed

- A format example that groups digits with a narrow no-break space (U+202F) or a thin space (U+2009) is now read as a thousands separator. The example `Intl` gives for fr-FR, `1 234,5` with U+202F, kept its tail as text, so every value printed a stray `234,5` after it, with no warning. A space and a no-break space (U+00A0) already worked.
