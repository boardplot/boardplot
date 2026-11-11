### Fixed

- A combo series with its own `format` holds its values to one scale, as on column: under "$1.2M", 4, 12, 43 and 78 print "$4.0 $12.0 $43.0 $78.0" (78 printed "$0.1k"). The description's column totals print with that format too ("A $0.4k", not "A 400"), and the mark values and annotation values take the same text as the label.
