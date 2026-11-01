### Changed / may need action

- An integrated variance chart now draws the shortfall cap as an outline in its good or bad colour. The shortfall is the stretch between the actual and a reference that the actual does not reach. Before, it was a solid block above the column, so the solid shape ended at the reference while the column's value was the actual. Now the solid shape ends at the actual. A cap over the column, where the actual beats the reference, stays solid. To bring back the solid cap, set the theme override `{ "surface": { "shortfallCap": "solid" } }`. The key entry for the cap is an outline too.

### Added

- Theme field `surface.shortfallCap`: `'outline'` (default) or `'solid'`. `'solid'` fills the shortfall cap of an integrated variance chart.
