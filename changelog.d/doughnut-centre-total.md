### Fixed

- A doughnut on a narrow canvas keeps its centre total. At 280 px the slice labels took the width, the ring stayed small and the total moved to the notes list. The ring now grows until its hole holds the total at the label size, or one type step smaller when the ring cannot grow that far. The slice labels that no longer fit go to the notes list. A doughnut whose hole already holds the total draws as before.
