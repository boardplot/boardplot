### Fixed

- A table with `columnHeads: false` no longer moves a magnitude letter or a unit into the hidden head row. Before, 9,500,000 printed as "9.5" with the "M" in a head that is not drawn, so a title in "$k" read as $9.5k. When the frame does not print a shared unit, each cell now keeps its unit and letter ("9.5M"), and a row-formatted unit under `magnitude` stays on its row label.
