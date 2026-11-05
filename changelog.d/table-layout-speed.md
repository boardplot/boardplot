### Changed

- A wide table with authored widths lays out about 3.1 times faster, with byte-identical output. A 26-column table with 25 authored widths went from 292 ms to 93 ms per layout at 878 px, and from 748 ms to 236 ms at 332 px, through a host font-table measurer with the bundled fallback. Smaller tables gain 1.2 to 2.4 times. Measurers from `createMetricTablesMeasurer` now keep an exact text cache of their own, and the bundled measurer's cache holds 65,536 widths in place of 4,096.
