### Changed

- A named `valueLine` at the level where its series ends no longer repeats the number of the end value. The name stands just left of that value: "Normal load" next to "53%". Before, the label read "Normal load 53%" beside "53%". A `label` with `${value}` brings back the old text: `{ "kind": "valueLine", "value": 53, "label": "Normal load ${value}" }`.
