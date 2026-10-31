### Fixed

- A grid written out in `data.panels` now colours a series alike in every panel where panels share series ids. Before, each panel coloured its series by position, so a series listed second in one panel and first in the next changed colour, and the key listed it twice with a `series-indistinguishable` warning. Panels that list the same ids in the same order, or that share no id, keep their colours. A series with its own `fill`, `colorRole` or `scenario` keeps it, and a panel that sets `highlight` or `emphasis` keeps its own colouring.
