### Fixed

- `measure` and render's size advice name the same refusal size for the same request in every call order. The widths a search keeps for later calls are now laid out as render draws them alone. Before, a status board refused at 160 px named 280 × 257 px in a fresh process and 280 × 254 px after a call at 320 px, and render draws it 257 px tall at 280 px.
