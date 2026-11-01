### Changed / may need action

- A dimension switch table on a fixed height now folds to the deepest depth that fits instead of refusing with `size-below-floor`. A table at depth 2 or 3 that misses the height draws one fold shallower, down to depth 1. By member it then also folds the Total. The warning `dimswitch-depth-folded` names the depth drawn, and its fix sets `options.depth`. An open height still grows to its rows. Old look: set `belowMinimum: "refuse"` to keep the refusal at the authored depth.

- A dimension switch table that folds to fit a fixed height sets the decimals of each change column from the rows it draws. A hidden row with a change under 5 % no longer keeps one decimal on the changes that show ("+130%" now, not "+130.0%"). The table on a narrow slide then also keeps more air between figures.

### Fixed

- A folded Total row in a by-member dimension switch table now shows its headline measure, as a folded member row does. It printed dashes in every column before. An open Total is unchanged.
