### Changed

- A sankey (its node and link values) and each pane of a butterfly or a pyramid print their values at one magnitude, as the funnel does: the largest step at which the smallest value still prints as 1 or more, while the largest keeps at most four digits. So `1,505M · 935M` instead of `1.505B · 935M`. A set that no single magnitude fits keeps one scale per label as before. Decimals and shares print as before. No option or theme patch brings back the old look for every chart. A chart `format` holds every label to the scale of its example, for example `"format": "1.2B"`.
