### Fixed

- A table drawn from a result that `prepareChart` made on the server sorted a number or date column by its printed text. A column of 7,800,000, 410,000, 1,251 and 88,000 sorted ascending as `1.3k · 7.8M · 88k · 410k`, and −2, −10, 3 and −0.5 as `−0.5 · −2 · −10 · 3`. It now sorts by the values, as the same table without a prepared result does: `1.3k · 88k · 410k · 7.8M` and `−10 · −2 · −0.5 · 3`. A date column sorts by date, not by the day it prints first.
