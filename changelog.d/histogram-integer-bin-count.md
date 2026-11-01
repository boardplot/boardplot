### Fixed

- A histogram of whole numbers with an authored bin count no longer draws fractional bins. Before, `bins: 20` over the days 1 to 13 drew a width of 0.6 with empty slots between the days, and `bins: 5` over 200 to 2,352 drew a width of 430.4. Now the width moves to the whole number that keeps the count nearest. Width 1 draws one bin per value, and a wider width starts on the smallest value so each bin spans that many whole numbers. The warning `histogram-bin-width-whole` names the width the count would have given. To keep fractional bins, set `bins: { width: <width> }`.
