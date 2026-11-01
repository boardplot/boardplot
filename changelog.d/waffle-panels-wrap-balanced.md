### Changed / may need action

- Waffle in cells mode now wraps its panels into two rows when a name is wider than its panel, instead of cutting it (`Infrastructure` no longer prints as `Infrastruct…`). Panels are as wide as the widest name, and the columns spread over the full plot width. Charts whose names fit in one row keep one row. Old look: none to restore as an option. The old look is the one-row form with cut names, which a wider chart still draws.
- Waffle wrapped rows now split evenly: 4 + 4 for eight squares and 3 + 2 for five panels, where square mode drew 7 + 1 and the wrapped columns sat in the left part of the plot. Old look: 7 + 1 rows have no option. A chart narrow enough to wrap draws its rows of equal length at the same panel size.
