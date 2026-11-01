### Fixed

- A sum of amounts that cancel now totals exactly 0 on a table, a waterfall, a bar or column stack and a dimension switch. Before, a total such as 0.1 + 0.2 − 0.3 kept a float residue of 5.55e-17. A waterfall closed at ">−0.1", a stack total printed "<0.1", a dimension switch printed "<1", and a ratio or share over the total printed a number with 17 digits. The ratio now prints n.m. and the share of a total of 0 prints n/a or n.m.
