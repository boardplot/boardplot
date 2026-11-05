### Fixed

- CLI: `render --quiet` prints each warning of severity `warn` as one line on stderr, `warning <code>: <message>`, before the line that names the written files. Before, quiet mode dropped every warning without a trace, so a shell loop never learned that a chart needed a fix. With `--out -`, stderr stays one JSON object, and these warnings stay in its `warnings` list.
