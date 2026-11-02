### Added

- Per-type React components accept `className` and `style` on a wrapper and a number for `size` or `fallbackSize` as a width in pixels. SVG components accept `background="transparent"` to leave out the canvas rectangle.

### Fixed

- Per-type React components render a refusal card for an invalid size or theme during server rendering instead of throwing.
