### Added

- Pyramid `basis: 'shareOfGroup'` divides each side by its own total, so each side sums to 100%. The unit reads "% of each group", or "% of each snapshot" when both groups carry a `date`.

### Changed / may need action

- A pyramid with `basis: 'shareOfTotal'` whose two groups both carry a `date` now draws each snapshot as its own 100%. Before, both snapshots were pooled into one grand total, the heads read "FY21, 43.2% of all", and a band whose share fell could print as a rise. The heads drop "of all", the unit reads "% of each snapshot", and differences print in percentage points of each snapshot. Pyramids without dates keep the grand-total share. To bring back the pooled look, remove the `date` field from both groups.
