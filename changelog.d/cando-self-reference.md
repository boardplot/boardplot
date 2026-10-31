### Fixed

- `canDraw` answers `ok: false` with `circular-reference` for options or data that hold a reference to themselves. It threw a `RangeError` before. `measure` refuses the same input with that code.
