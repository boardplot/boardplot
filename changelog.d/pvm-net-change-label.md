### Changed / may need action

- A pvm bridge prints the net change from the opening to the closing total above the closing column, as the signed amount and its percent in the sign colour (for example `−12,779 (−14.2%)`). It uses the number format of the steps. Where the full line does not fit beside its neighbours, it stands on two lines, and a step's own value always keeps its place before it. Old look: set `options.netChange: false`.

### Added

- `options.netChange` on `pvm`, default `true`. `false` draws the closing column with its value only, as before.
