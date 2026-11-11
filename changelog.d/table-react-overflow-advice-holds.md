### Fixed

- The React table's `table-overflow` advice now names a frame width at which the grid no longer scrolls. The advice was computed in the type of the asked width, and a frame past the 720 or 1080 px type step draws larger type, so the grid still scrolled at the advised width. The advice is now checked at the advised width; where no width settles, the warning keeps no patch.
