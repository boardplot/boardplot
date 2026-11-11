### Fixed

- A grid that draws at a width now draws at every wider width. Before, the one-column card form stopped at 480 px, and a grid whose two-column form needed a few pixels more was refused between them (for example, drawn at 479 px, refused from 480 to 487 px, drawn again from 488 px). Where the grid's own form would refuse the width, the grid now draws its card form, as the narrower width does. A grid that drew before keeps its look.
