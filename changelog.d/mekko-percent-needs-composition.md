### Fixed

- A `valueLine` with no number, the automatic mean, is dropped from a 100% mekko, column or bar chart (`stacked100`) when the mean of the drawn columns is 100, because the line then always read "Average 100%". It warns `valueline-unsupported-stacked100` with a fix. The line stays when the mean is below 100, as with a `total100` larger than the parts or authored percent cells that add to less than 100. A numeric `valueLine` is not affected.
