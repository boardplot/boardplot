### Fixed

- A table heat lane with `scale: 'diverging'` and neither `bins` nor `steps` no longer prints a key of default point bands. That lane tints continuously up to its `cap`, so the key named bands such as "1 to under 4" that no cell took. The lane now prints no key, as a `column` lane does. A lane with `bins` or `steps` keeps its key.
