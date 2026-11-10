### Changed

- `labels.valueLine` on a chart that labels each valueLine annotation itself (line, for example) is still refused, and the refusal now names `label: false` on each `{ kind: 'valueLine' }` annotation, with a fix that sets it. A `footnote` on a metric-stack category is still refused, and the refusal now names `options.footnotes` and the partial-period footnote.
