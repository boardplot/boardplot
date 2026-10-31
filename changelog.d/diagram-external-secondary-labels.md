### Fixed

- A roadmap milestone and a cycle step with a `secondaryLabel` now draw the secondary text under the name outside the node. Before, the text had no seat inside the small node and moved to an off-page note, so a roadmap with a date on each milestone showed none of them. The name and the secondary text move together to one side of the node. Where that taller block finds no seat, the name draws alone and the secondary text stays in the note with the warning `diagram-secondary-label-unplaced`, as before.
