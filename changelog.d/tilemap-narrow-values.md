### Fixed

- A narrow tile map now prints its values. Where the values do not fit under the codes at the label size but all fit at the type floor, every tile steps down to the floor together, so the map keeps one text size. A map whose values still do not fit at the floor keeps its codes at the label size, as before. To bring back the old look, a narrow map sets `regionValues: false`, which prints codes alone at the label size.
