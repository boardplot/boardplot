### Fixed

- `measure` on a dimension switch table is faster. Each size it tried compiled every table form again, so a measure call took several times its render. The compiled forms are now kept across the sizes of one call. The measured size and the drawn table are unchanged.
