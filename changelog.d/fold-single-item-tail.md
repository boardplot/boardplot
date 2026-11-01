### Fixed

- A topN fold of one item keeps that item's own name on a Pareto, bar, column, butterfly, pie and mekko chart. A Pareto with `topN: { n: 5 }` on six causes now draws the sixth as "Labelling error" and not "Rest (1)", and a bar chart draws it under its name and not "Others". An authored `topN.restLabel` still names the bucket.
