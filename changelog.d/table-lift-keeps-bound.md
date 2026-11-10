### Fixed

- A table, dimswitch, cohort table or cascade bar table no longer prints a small nonzero value as 0 at a narrow width. Before, where the bound ("<0.1%") needed more width than the rounded text, the layout fell back to the rounded text: a dimswitch at 320 px printed 0.025 as "0.0%" and −0.015 as a coloured "0.0pp", while 400 px printed "<0.1%" and ">−0.1pp". The bound now always prints; where it needs more width, the table uses its narrow-width steps or refuses with the width it needs.
