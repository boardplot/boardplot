### Fixed

- A PNG with emoji or CJK in a label no longer loses the whole label. The PNG renderer resvg draws a text run with a character the theme font lacks as boxes and drops the Latin words next to it, so `🇩🇪 Germany` came out as boxes only. A chart with such a character is now drawn by Chrome when Chrome is installed, and the warning `png-glyph-coverage` is gone for it. Without Chrome the PNG is unchanged, and the warning now names the labels that can be lost. SVG output is unchanged.
