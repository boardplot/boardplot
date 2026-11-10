### Fixed

- A table whose `options.unit` names a scale ("$k", "EUR m", "USD bn") no longer adds its own magnitude on top of it. Before, values of a million or more under "$k" printed as "8.5" with the subtitle "Revenue in M", and the hover card and accessible text read "$8.5 k M". The table now prints the whole figure, "8,540,000", under "in $k", as the bar table and the other charts do under such a unit. A column or row format keeps its own magnitude.
