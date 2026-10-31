### Fixed

- A combo with a secondary axis now runs its rows up to an authored `valueAxis.max` or `valueAxis.min`. Before, the left ticks stopped at the last round step under the bound (20,000 under a max of 24,000), and the right ticks left the gridlines. A bound that no round step divides gets even rows.
