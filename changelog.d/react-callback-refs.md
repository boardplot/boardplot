### Fixed

- A chart no longer re-renders without end when its host stores a new object from an inline `onGeometry`, `onNotes` or `onRefused` callback. Each new callback fired the chart's effect again, so a host that wrote `onGeometry={g => setBox({ w: g.size.width })}` froze the tab. The chart now holds these callbacks in a ref and calls them when the geometry, the notes or the refusal change.
- A table or DimSwitch chart refused at an inline `size={{ … }}` no longer re-renders without end. The new size object remade the refusal on every render; the size is now compared by content.
