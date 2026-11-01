### Fixed

- A status board with `labelDensity: 'full'` no longer drops its cell state names without a word at a narrow width. The names first step down the type scale to the floor of the target. Names that still do not fit are reported with a `label-hidden` warning and listed in `reading.omissions`, one entry per state, and the state key stays.
