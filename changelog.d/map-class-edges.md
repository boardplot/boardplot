### Fixed

- A choropleth or tilemap with `classes` and a format coarser than the class width keeps its classes apart. A map of values from 1.2M to 1.48M with the format `$0M` printed `$1M to under $1M` and gave every region one colour. The key now prints the edges with the fewest extra decimals that keep them ascending, so the same map prints `$1.26M`, `$1.31M`, `$1.37M` and `$1.42M`. A map whose rounded edges already ascend is unchanged.
