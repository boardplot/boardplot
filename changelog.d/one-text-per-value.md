### Fixed

- The hover card, the reading and the chart description now print a value as its label prints it. A card printed `$0.1k` beside a bar labelled `$78.0`, and a callout's `${value}` printed `−600,000` beside a dot labelled `−600k`. With labels off, a value under an authored format prints the text its label would carry.
- A table percent change is no longer `n.m.` when its base is above zero but prints as `0`, and an integrated column variance shows its growth figure when the reference prints as `0`. A base of zero or below stays `n.m.`.
- The reading and the data table no longer print binary float digits such as `7.300000000000001%`.
