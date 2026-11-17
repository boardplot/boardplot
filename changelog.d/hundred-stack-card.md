### Fixed

- On a 100% stacked column, bar or area chart of counts whose `unit` is a percent, such as `"% of group"`, the hover card printed each count with that unit and left out the share the segment prints. A segment labelled `44%` read `191 % of group` in its card. The card now prints the count without the percent unit and the share as the segment prints it: `191` and `Share: 44%`. Parts that already add up to 100 are shares, and their card prints the value with its unit once, as before: `44%`. The accessible records carry the same value and share.
