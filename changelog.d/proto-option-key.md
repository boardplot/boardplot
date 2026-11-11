### Fixed

- An options key named `__proto__` is refused with `unknown-option` at its path, like any other unknown key, in a bare chart, a chart of an envelope, a grid panel and a repeat template. It was dropped without a message. Keys named `__proto__` inside `labels`, `labelPlacements` and `labelOffsets` reach their checks too.
