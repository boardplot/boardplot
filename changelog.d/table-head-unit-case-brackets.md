### Changed / may need action

- Table, bartable and cohort column heads still print in capitals by default, but now keep text in parentheses or square brackets and a word with a capital inside it (`mW`, `kWh`, `eBay`) as written, as they already kept the text after the last comma. `Standby power (mW)` printed `STANDBY POWER (MW)`, which reads as megawatts, and `Memory (Mb)` printed `MEMORY (MB)`. It now prints `STANDBY POWER (mW)` and `MEMORY (Mb)`. To bring back full capitals for a head, write it in capitals, for example `Standby power (MW)` when megawatts are meant.
