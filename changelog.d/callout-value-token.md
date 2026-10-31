### Fixed

- A callout or note on a mark that already prints the same number leaves `${value}` and the words that led into it out of its text, and until now said nothing. It now reports the info warning `annotation-value-on-mark`, which names the value. The drawing stays the same.
