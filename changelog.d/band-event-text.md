### Fixed

- A `band` or `event` annotation with `text` and no `label` now prints the text as its label, with the info warning `annotation-text-as-label` and a patch that renames the field, as a `valueLine` does. Before, the caption was dropped without a warning. A `text` beside a different `label` is refused with a patch that removes it.
