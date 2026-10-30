### Fixed

- A mekko no longer adds rates into its Others column. On a bar mekko with `topN` rest and a width series, Others prints the width-weighted mean of the folded heights, so 12.5% and 18.9% at widths 38 and 25 print 15%, not 31.4. A folded percent cell stays a percent on a bar or stacked mekko, in the label, the description and the hover card. A bar mekko without a width series still adds plain numbers. The mean of its percent cells is unweighted, because its columns are equal.
