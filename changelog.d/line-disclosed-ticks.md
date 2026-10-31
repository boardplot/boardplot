### Fixed

- A line chart with a shown value axis now keeps the tick of a nonzero baseline and the tick of a value line that extends the axis. The axis replaced both with its own ladder, so a baseline of 41 printed no 41 and a value line at 37.5 left a spurious decimal on the other ticks (40.0, 50.0, 60.0). A regular tick still drops where it would collide with a disclosed one. A first time tick label that would collide with the baseline label now starts at the plot's left edge instead of dropping.
