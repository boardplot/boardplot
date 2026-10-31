### Fixed

- The reading of a `pure` or `stepped` cohort now quotes the cell text the chart prints. These variants reported every printed cell as "Not displayed" with `visible: false`. A cell left out by `visiblePeriods` still reads as not displayed, and its claim names no scene node.
