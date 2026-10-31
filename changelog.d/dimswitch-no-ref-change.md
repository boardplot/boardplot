### Fixed

- A dimswitch period whose facts carry no `ref` no longer prints n/a under every figure. Its change cells are blank, and when no displayed period has a `ref` the change line is left out. A period where only some facts lack `ref` still prints n/a for those members.
- A dimswitch `options.encodings` key that names no column now gives the warning `dimswitch-encoding-column`. It names the closest column, such as `pp` for a key `prior`, and lists the column ids: `range`, `pp`, `pl` with a plan, and the displayed period ids.
