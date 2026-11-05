### Fixed

- An unknown option named like another library's axis title (`xTitle`, `yAxisTitle`, `xLabel`, `y_axis_label`) points to `axisTitles.x` or `axisTitles.y` where the type has them, else to `axisTitles`, and a type without axis titles names no near key. Before, `xTitle` and `yTitle` answered "try: title" with a fix patch that moved the axis title into the chart title, and `yLabel` pointed to `labels`.
