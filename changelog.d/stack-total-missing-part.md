### Fixed

- On a stacked column, bar or combo, a growth rate (CAGR), a difference, a delta or an `abs` value anchored to a stack total with a missing part (null or absent, not 0) now prints no number and warns `bad-anchor`, as on a mekko and a stacked area. Before, it computed from the drawn parts alone and compared a full total with a partial one, for example "−50.0% p.a.". The reading holds no claim for it either. The stack total label keeps counting the drawn parts, with its disclosure. To compare one part, anchor to its series: `{ "categoryId": "2023", "seriesId": "<series>" }`.
