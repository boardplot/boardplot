### Fixed

- A full theme whose `color.series` has one or two colours draws. Before, it was refused with `invalid-theme` ("expected array to have >=3 items"), so a brand theme for a two-series chart had to add an unused third colour. A series past the end of the ramp follows `color.seriesOverflow`, as before. No golden changes.
