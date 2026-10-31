### Fixed

- A mekko column total no longer prints a nonzero total as 0 under a whole-number format. Totals of 0.4 and 0.2 print 0.4 and 0.2 under `format: "1,234"`, in the label and in the description. The total takes only the digits it needs, and every other number keeps the authored format. `format-hides-values` still warns.
