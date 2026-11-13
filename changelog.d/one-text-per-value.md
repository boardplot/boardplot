### Fixed

- The hover card, the reading and the chart description now print a value as its label prints it, also when the label is not drawn (labels off, or dropped for room) and the value has an authored format. A card printed `$0.1k` where the label would read `$78.0`, and a callout's `${value}` printed `−600,000` beside a dot labelled `−600k`.
- A table percent change and an integrated column growth figure no longer print `n.m.` when the base is above zero but prints as `0`. A base of zero or below, and a table change above the cap of ±999 %, still print `n.m.`
- The reading and the data table no longer print binary float digits such as `7.300000000000001%`.
