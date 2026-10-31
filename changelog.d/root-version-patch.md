### Fixed

- A chart sent beside a root `version` no longer gets patches that delete it. The refusal now names only `version` and its fix removes only that key, so applying it leaves a chart that draws. A root key that a chart does not take, such as `title` or `unit`, now gets a fix that moves it into `options` instead of a remove, so a repair loop keeps the title and the unit.
