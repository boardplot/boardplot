### Added

- A numeric `valueLine` within ±1 on fraction data now warns `percent-scale-suspect` where it sits far below the values. A line of 0.05 printed `Target 0.05%` beside bars of 4% with no word. The warning carries a fix that sets `valueKind: "fraction"` on the line. The chart draws as before.
