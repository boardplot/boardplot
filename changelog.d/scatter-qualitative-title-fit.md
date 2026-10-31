### Fixed

- A qualitative scatter no longer prints its y axis title over the Higher and Lower end labels in a short plot. With `qualitativeAxes`, a plot too short for the wrapped title between its two ends now drops the title and its two arrows, keeps both end labels, and warns `axis-title-dropped`. A plot too short for two end labels keeps the Higher end. A plot tall enough for its title is unchanged.
