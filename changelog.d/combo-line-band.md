### Fixed

- On a dual-axis combo, the line no longer runs through the columns when a scale pair that keeps the columns a third of the plot high cannot keep it above them. The columns now shrink to as little as a quarter of the plot, so the line gets a clear band. The info lint `dual-axis-columns-squeezed` names the squeeze and suggests splitting the chart or pinning `secondaryAxis.domain`. A combo whose line already clears its columns draws as before.
