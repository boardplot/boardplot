### Fixed

- A creative card that draws at a width now draws at every wider width. Before, a name or other text with no break point (a long file name, or Chinese or Japanese text) could fit the stacked card under 640 px and the smaller type under 720 px, and throw `creative-text-overflow` just above those steps (for example, drawn at 719 px, refused from 720 to 732 px). Where the card's text overflows, it now draws as the narrower width does: in the smaller type, then stacked. A card that drew before keeps its look.
