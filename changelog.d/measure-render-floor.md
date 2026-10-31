### Fixed

- `measure` and `render` name the same size. A `minHeightAtWidth` for a diagram whose labels cannot be placed now follows the height that the refusal names, so a card pinned at it draws. A width-only diagram refusal on a narrow card names the narrowest width that draws, the width `measure` reports as `minWidth`, and no longer the 480 px floor. A pinned choropleth reports the height it draws, which includes its source and credit line, and no longer the pinned height.
