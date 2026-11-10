### Changed

- A funnel prints its segment values and stage totals as one set: one magnitude and one decimal count, so `1.18B · 0.59B · 0.29B · 0.14B` instead of `1.18B · 590M · 290M · 140M`, and `5.0 · 1.0 · 0.6` instead of `5 · 1 · 0.6`. The step rates and, on the centered funnel, the cumulative rates are sets of their own: `9.7% · 30.6% · 100.0%` instead of `9.7% · 31% · 100%`. Hover text and the description print the same text as the label. No option or theme patch brings back the old per-label precision; an authored `format` still sets the scale and decimals of the values.
