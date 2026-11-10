### Fixed

- A computed box statistic (median, interpolated quartile, whisker end) prints without binary float residue in the hover card and the accessible text. Before, a median between −75 and 73.9 printed `−$0.550000000000004k`. The text now rounds it to 12 significant digits of its own size. The statistic itself, its fences and its outliers stay exact, and a value that equals an observation stays as authored.
- A Likert sample size summed from counts prints without float residue. Before, the hover card printed `Sample size: 0.8999999999999999`. An authored `n` stays exact.
- A scatter quadrant cut from `stat: "mean"` or `"median"` drops float residue before it is printed and applied. Before, the cut label printed `Mean 0.005000000000000001`.
