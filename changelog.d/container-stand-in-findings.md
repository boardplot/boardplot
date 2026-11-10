### Fixed

- React no longer reports `observed-display-too-small` for a container chart or table that is shown at another width than it was laid out for: that drawing stands in for the layout at the new width, such as the `fallbackSize` frame before the container reports its width, or the last size while a resize lays out. A size refusal of the last size also waits while a newer size still lays out, so a busy page no longer logs a refusal for a chart that then draws. A chart of a fixed size shown in a narrower box still warns, and a refusal at the final size is still reported.
