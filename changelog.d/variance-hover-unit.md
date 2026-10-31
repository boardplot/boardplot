### Fixed

- The hover card of a relative variance chart no longer prints the percent unit on plain values. With `unit: '%'` the card read "Order intake: 412%" and "Plan: 400%" for counts, and the difference as "+12pp". The percent unit now belongs to the relative change only, as in the drawing, so the card reads 412, 400 and "+12 (+3%)". A `series[].unit` still applies to the plain values and their difference.
