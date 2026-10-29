### Fixed

- A neutral grey in a theme no longer warns `accent-reads-as-loss`. Before, a grey `neutralMark`, `highlight`, `focus`, `total` or first series near a muted red-brown `bad` colour warned, because a grey has no OKLCH hue and the check fell back to RGB distance under 90. A colour with OKLCH chroma under 0.02 now counts as grey and skips that fallback. A muted warm accent near a muted `bad` still warns. No golden changes.
