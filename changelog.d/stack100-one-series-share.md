### Fixed

- A 100% stack with one series (column, bar or 100% area) now records the share it prints. Before, each segment printed `100%`, but its record held only the raw value and no share, so the hover card, the accessible text and `reading` could not tie the printed number to a source. A plain stack with one series still records no share, because it prints none.
