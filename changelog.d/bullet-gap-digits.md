### Fixed

- Bullet values, targets and gaps use one decimal count per row. A value of 2.6 against a target printed as 2.3 now shows a gap of +0.3. The gap equals the difference of the printed numbers, while derived data keeps the exact difference. A gap that prints as zero has no sign and reads as on target in the target and gap columns and stacked rows. A gap between values in scientific notation prints in that notation too (+1.0 × 10⁻⁵), not as 0.0000.
