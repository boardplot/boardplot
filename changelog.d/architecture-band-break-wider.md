### Fixed

- An `architecture` diagram whose nested zone drew across two bands at a narrow width is no longer refused at a wider one. The wider width kept that zone in one band, and when no such layout routed it refused with `diagram-route-unresolved`; it now also tries the band breaks of narrower widths before it refuses.
