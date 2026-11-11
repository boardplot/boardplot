### Fixed

- An architecture diagram with a labelled self-loop now draws at every width from the one where it first draws. Before, the loop hung a fixed 2.25 spacing units below its node, too short to hold one line of the larger edge text beside it, so a long loop label had no seat from 1080 px and the diagram was refused with `diagram-route-unresolved`. Now a loop whose label has no seat hangs deeper, as far as the label needs, and a label wider than the room beside the loop wraps to two or three lines. `measure` names the same `minWidth` as render.
