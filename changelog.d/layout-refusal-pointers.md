### Fixed

- A layout refusal of most chart types now names the exact authored field in `path` and its value in `received`. These refusals gave an empty path, a path at the chart root such as `/series`, or, for a tornado, football field, funnel or pie with a reference series first, the wrong series.
