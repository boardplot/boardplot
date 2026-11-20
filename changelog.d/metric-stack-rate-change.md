### Fixed

- A metric stack rate panel with `readout: "change"` that sets `decimals` or `divisor` computed its headline from window rates that were first rounded to one decimal, so it could print the wrong change. A rate that fell from 0.85% to 0.74% read `−0.2pp` (0.7 − 0.9). The headline now takes the difference of the unrounded rates and rounds it once to the panel `decimals`, one by default, so it reads `−0.1pp` and prints the same digits as the span. With `decimals: 2`, 0.552% to 0.545% now reads `−0.01pp`.
