### Fixed

- A theme's `table.inks` colours are held to the contrast floor of the ink they stand for, where the table draws them: a head, label or figure ink below 4.5:1 on the background refuses with `contrast-ink`, and a muted table ink (secondary, qualifier, operator, driver, toggle) below 3:1 with `contrast-ink-muted`. Before, `table.inks.head: "#DDDDDD"` on white drew nearly invisible heads with no finding.
