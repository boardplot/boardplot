### Changed / may need action

- An org chart and a customer journey on a canvas with a set height, such as a full slide, now grow the gaps between their levels into the spare height instead of floating in the middle with empty bands above and below. The gaps grow up to 2.6 times, using 80% of the spare height, and stop growing when the spare height is used. The boxes keep their size. A canvas without a height, or one with no spare height, draws as before. The same rule applies to the stacked org chart and to the journey with phases in rows. At 888 x 396 pt the org chart now uses about 66% of the plot height where it used about 42%.
- Old look: set `heightFill: 'none'` in the options of the chart. The gaps keep their natural size (7.2 and 4.8 or 5.2 times the base unit for the org chart, 4.8 for the stacked org chart, 2 and 1.2 for the journey rows, 1 for the journey phases) and the block is centred in the canvas, at the same canvas size as before. The chart type `diagram` takes `heightFill` with the variants `hierarchy` and `customer-journey`; other variants refuse it.

### Added

- `diagram` has the option `heightFill`: `'rows'` (default) spreads the spare height of a canvas with a set height over the gaps between the levels of an org chart (`hierarchy`) and a journey (`customer-journey`), and `'none'` keeps the natural gaps. It uses the same name and values as the `heightFill` option of `table`, `bartable` and `cohort`.
