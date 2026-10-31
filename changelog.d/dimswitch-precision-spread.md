### Changed

- A dimswitch money or count measure now gives each period column the decimals its own largest figure needs. Before, the Range total set one precision for every column, so period cells of 1.46M and 1.44M under a Range total of 18.2M printed 1.5M and 1.4M, and a small member printed the same string in every period. Now those periods print 1.46M and 1.44M, and the Range column keeps 18.2M. A column never prints fewer decimals than before. The old look, one precision for every column, comes back by leaving `scale` off the measure and setting its `format`, for example `1.23M`.

### Fixed

- A dimswitch measure with `scale: "money"` and a unit that names a magnitude, such as `Mio. CHF`, now warns `dimswitch-scale-unit`. Scale `money` reads the values as currency units and climbs to k, M or B itself, so 1,320 Mio. CHF printed 1.32k with no warning. The warning says to use scale `count` or to send the values in the base unit. A unit with the currency after the magnitude word (`Mio. CHF`, `k EUR`) is now read as a magnitude everywhere, as `CHF Mio.` already was.
