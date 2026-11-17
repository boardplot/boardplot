### Fixed

- A chart component such as `TableChart` with a BigInt in a setting, for example `rowLabelLines={2n}`, threw "Do not know how to serialize a BigInt" and took the whole React root down with it. It now draws the refusal card with `invalid-argument` at `options.rowLabelLines`, says that settings take numbers, and suggests `Number(2n)`. The other charts on the page keep drawing.
