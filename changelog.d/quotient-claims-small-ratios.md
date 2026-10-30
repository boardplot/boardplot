### Fixed

- A claim for a ratio keeps a tiny real value. The residue cleanup measured a ratio against its operands, so 1 of 100,000,000 retained read as 0 in `reading.derived`. Cohort rates, funnel conversions, shares, ratios, pareto shares and `percentOf` now keep 12 significant digits of their own value. A value that printed before can show more digits in the reading.
