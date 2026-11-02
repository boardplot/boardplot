### Added

- A format example with no digit and one run of `@` prints a fixed count of significant figures. `"$@@@M"` prints 42,700,000, 4,270,000 and 430,000 as `$42.7M`, `$4.27M` and `$0.430M`, where `"$1.2M"` fixes one decimal and prints `$4.3M`. Trailing zeros stay, the value rolls up at 1000, and axis ticks keep the example's style with digits from their spacing. A split run (`"@@.@%"`) or more than 15 `@` is refused with a fix. Every example with a digit prints as before.
