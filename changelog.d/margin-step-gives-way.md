### Fixed

- A chart refused for width just over a default canvas margin step (from 600 to 614 px and from 840 to 846 px) now draws with the margins of the width just under the step when it fits there. Before, a bar table that drew at 835 to 839 px was refused at 840 to 842 px. Every chart that drew before keeps its layout, and `measure` names the same floor and margins as render.
