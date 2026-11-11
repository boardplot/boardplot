### Fixed

- A sankey keeps one magnitude for its node values when one small link fits no shared step: "Alpha 1,500M" beside "Other use 400.4M", where it printed "Alpha 1.5004B". The small link prints at its own scale ("400k"), as other values under a shared scale do.
