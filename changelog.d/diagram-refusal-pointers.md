### Fixed

- Every diagram layout refusal that names one node, edge, group, lane, channel or callout now carries the JSON Pointer of the authored field as `path` and its value as `received`, for example `/data/edges/2/source` or `/data/nodes/4/shape`. The pointer names the item with that id in the order you wrote it, also when `order` draws it elsewhere. A refusal about a whole list points at that list under `data`, for example `/data/lanes`. Before, `path` was empty, or named the list at the chart root (`/lanes`).
