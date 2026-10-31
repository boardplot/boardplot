### Fixed

- A table row with `sign: -1` now draws its arrow and sorts by the figure it prints. A Cost row that printed a change of −20 drew an up arrow, and the column sorted by the supplied figures. A ratio column over two cells of such a row, such as actual over plan, printed −1.50 where the printed figures give 1.50. It now prints 1.50. Tone, heat and bars still judge the supplied figure, so `lowerIsBetter` on a cost still reads a rise as bad.
