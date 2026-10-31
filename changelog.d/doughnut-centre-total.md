### Fixed

- A doughnut on a narrow canvas keeps its centre total. At 280 px the slice labels took the width, the ring stayed small and the total moved to the notes list. When a layout drops the total, the ring now grows until its hole holds the total at the label size, or one type step smaller when the ring cannot grow that far. The slice labels that no longer fit go to the notes list. A doughnut that already draws its total, and one whose ring cannot reach either size, draws as before.
