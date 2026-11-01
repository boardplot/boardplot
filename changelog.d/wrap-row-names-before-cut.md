### Changed / may need action

- Dot and status charts on a pinned height now wrap row names before they cut one. When the row pitch holds two lines of names only in a smaller font, the name column takes that font (the next theme step down, else the target's floor for axis text, which is 12 pt on a slide) at a 1.1 leading and draws two lines. A name is cut with an ellipsis only when two lines do not fit either. A chart whose names already fit at the axis size keeps that size and its look.
  Old look: every name on one line at the axis size (13 pt on a slide), cut with an ellipsis, with its full text in the label's title and the notes list. No option brings it back, because a name that fits is never cut on purpose. To keep names on one line, shorten them.
