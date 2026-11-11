### Fixed

- A column or line chart with one series and `valueAxis.percent` now records the share it prints. The percent axis draws such a chart as a 100% stack or 100% area, so each mark printed `100%`, but its record held only the raw value and no share, so the hover card, the accessible text and `reading` could not tie the printed number to a source.
