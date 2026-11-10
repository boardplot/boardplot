### Fixed

- Grid: `sharedScale: true` and the default shared scale now share the value axis of dot and bar panels, which draw it across. Before, the grid read a panel's domain from a vertical axis only, so these panels kept their own scales and no warning said so. No fixture changes: none has dot or bar panels that share a scale.
