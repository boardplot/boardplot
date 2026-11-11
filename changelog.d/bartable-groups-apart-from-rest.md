### Fixed

- A bar table with row groups and grey rest rows now draws every plain group in a colour apart from the rest rows' grey. A third group could take the same grey as the rest rows, so the key showed two identical swatches and `series-indistinguishable` fired. Each group now takes its ramp step in the active theme, so a light-to-dark repaint decides again.
