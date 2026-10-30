### Fixed

- `ScaleGroup` now shares its scale across `BoardplotChart` members. Before, the group planned before the chart type's chunk arrived, refused every member with `scale-group-unknown-type` and never planned again, so each chart kept its own scale with no warning. The group now plans again when a chart type registers. A member that uses a chart type's own component, such as `LineChart`, does not change.
