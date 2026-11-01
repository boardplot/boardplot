### Fixed

- A bubble matrix with a pinned height sizes its size key from the bubble it draws. Before, the key was as tall as a column is wide, so a matrix with few wide columns lost a third of its height to the key and the rows were squeezed. A 4-stage, 8-row matrix at 960 x 380 pt refused with `size-below-floor` and now draws. At a larger pinned height the key band is shorter and the rows are taller. A matrix whose height comes from its content keeps its key.
