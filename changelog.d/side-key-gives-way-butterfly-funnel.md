### Fixed

- A butterfly or funnel chart with its key beside the plot (`legend: 'left'` or `'right'`) no longer refuses a width where it draws with the key in the row above the plot. Before, the butterfly `fixed-label-column` with `legend: 'left'` drew from 311 px and was refused at 358 to 393 px, and the centered funnel `lead-funnel-centered` drew at 289 to 298 px and was refused at 299 to 302 px. Both now draw at every width from their first drawn width, with the key above the plot at the widths that were refused.
