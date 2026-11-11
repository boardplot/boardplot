### Fixed

- A table row with an authored scaled format gives more digits only to the cell that would print 0: a Cost row in `$1M` prints `$4M`, `$6M`, `$0.002M`, not `$4.000M`, `$6.000M`, `$0.002M`.
