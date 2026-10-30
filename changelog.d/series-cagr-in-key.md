### Fixed

- `seriesLabels.cagr` on a stacked column chart no longer loses its rates when a key names the series. Before, a chart with a key (asked for, or drawn for a forecast hatch) dropped right-edge names wider than one column step, and the rates went with them, with no warning. The key now prints the rate beside each series name, such as "Product B +10.1% p.a.", and the claim record stays. Charts whose edge names fit do not change.
