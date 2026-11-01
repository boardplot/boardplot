### Added

- `highlight` on a sankey. Name one or more node ids: those nodes and the ribbons they touch take the accent, and every other node and ribbon stays neutral. With `linkColor: 'source'` or `'target'`, only the ribbons that end at a highlighted node on that side take the accent. A highlight id that matches no node warns `highlight-unknown-id`. Before, a sankey refused `highlight`.

### Changed / may need action

- A sankey with no `linkColor` now draws every node and ribbon in the neutral mark colour. Before, each node took a palette step, so a chart with many nodes showed all palette colours at once and the last column fell to grey. A node with `fill` or `colorRole` still colours the ribbons it touches. To bring back the old look, set the option patch `{ "linkColor": "source" }`. An explicit `linkColor` of `source` or `target` keeps the palette look, unless a `highlight` is set: then only the highlighted nodes keep a colour.
- The `sankey-colors-shared` note appears only under an explicit `linkColor`, because only that look takes palette steps.
