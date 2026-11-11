### Fixed

- `measure` gives the same `minWidth` for the same request in every call order. Before, a chart refused at a width where its narrower form was refused too was measured in that narrower form, and the answer was kept for later calls: a waffle at 320 px named 400 px in a fresh process and 752 px after a call at 390 px. It now names the floor of the form as asked (752 px here) in every order. The width render draws from stays in `compactFloor`.
