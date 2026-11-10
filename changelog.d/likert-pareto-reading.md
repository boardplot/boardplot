### Fixed

- The reading of a Likert chart now quotes the printed net and the printed shares, and the reading of a Pareto chart quotes the printed cumulative shares. Before, `reading.derived` called them "Not displayed" with `visible: false` although the chart prints them. The SVG is unchanged.
