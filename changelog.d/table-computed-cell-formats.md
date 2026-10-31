### Fixed

- A table row format no longer reaches a computed column that yields a percent or a share. A percent change or a share under a row format of `$1.2m` printed `$0.0M`. It now prints in points, as the column does without the row format. To bring back the old text, give the column `format: "$1.2m"`. A format on a computed cell now takes effect. A delta cell with format `+1.0pp` printed `+1`, and it now prints `+1.3pp`.
