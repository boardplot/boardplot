### Fixed

- A value heatmap and a cohort heatmap now print all of their numbers or none of them. Before, when no shorter text fitted, the cells with room still printed and only the cells without room lost their number, so a matrix showed numbers around gaps. Now a matrix that cannot fit every number at the label floor prints none, warns `label-hidden`, and lists the numbers in the note. A column that holds one value in every cell may still stay blank, and a matrix whose numbers fit is unchanged.
