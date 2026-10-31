### Fixed

- A chart or table in a container no longer throws "Prepared chart does not match the resolved request." when its host passes a new `prepared` value after the container measured a size other than `fallbackSize`. This happened with equal content and with new data plus its own snapshot, and it left an empty root after a normal parent render. A snapshot is checked at the fallback frame it was laid out at, and the chart then lays out at the measured size. A snapshot made for different content still throws.
