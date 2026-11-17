### Added

- A waterfall step without segments takes `colorRole`, the same theme colour roles a segment takes. `{ "id": "cut", "label": "Out of budget", "value": -10, "colorRole": "neutralLight" }` draws a grey step without a one-segment workaround. A total, a step with segments and a bridge with cases refuse it with a hint. The new fixture `grey-steps` shows grey steps beside a signed one.

### Fixed

- `labelPosition` did not reach the value of a waterfall step with one segment: under `labelPosition: "center"` its value stayed outside the bar, and the value inside the segment dropped as a repeat. The value of a one-segment step or total now takes the asked seat inside the bar when it fits, and falls back as a plain step's value does.
