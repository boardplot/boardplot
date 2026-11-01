### Changed / may need action

- A waffle chart with one panel and one series on a pinned height (a slide, or any canvas with an authored width and height) now draws the value and the panel label beside the filled cells, as a short tick, the value and the label under it. The grid takes the full plot height, so its cells grow (a 888 x 396 pt slide goes from a 284 px grid to a 367 px grid, which is 67% more area), and the stack of label, value and grid above it is gone. The form is used only when its cells are at least 10% larger than the stacked form draws them. A chart with no authored height, a card, a report, a subtotal, `headline: 'none'` or more than one series keeps the stack.
  - Old look: `heightFill: 'none'` restores the stacked label, value and grid on a pinned height, with the same drawing as before.

### Added

- `waffle` has the option `heightFill`: `'rows'` (default) lets one panel with one series take the full height of a pinned canvas, with the value and label beside the filled cells, and `'none'` keeps the stack of label, value and grid.
