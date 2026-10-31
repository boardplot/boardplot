### Fixed

- A table share column no longer drops the rows that `topN` with `rest: false` hides from its denominator. Before, the kept rows of a four-row table printed 62.5% and 37.5% and the total row printed 125.0%. Now the kept rows print their shares of the whole table, 50.0% and 30.0%, and the total row prints 100.0%.
