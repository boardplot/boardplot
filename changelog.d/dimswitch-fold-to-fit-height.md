### Changed / may need action

- A dimension switch table on a fixed height now folds to the deepest depth that fits instead of refusing with `size-below-floor`. A table at depth 2 or 3 that misses the height draws one fold shallower, down to depth 1. By member it then also folds the Total. The warning `dimswitch-depth-folded` names the depth drawn, and its fix sets `options.depth`. An open height still grows to its rows. Old look: set `belowMinimum: "refuse"` to keep the refusal at the authored depth.

### Fixed

- A folded Total row in a by-member dimension switch table now shows its headline measure, as a folded member row does. It printed dashes in every column before. An open Total is unchanged.
