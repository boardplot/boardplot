### Fixed

- A chart sent beside a root `version` no longer gets patches that delete it. The refusal now names only `version` and its fix removes only that key, so applying it leaves a chart that draws. A top-level `title`, `subtitle`, `unit` or `source` string beside a chart now gets a fix that moves it into `options` instead of a remove, so a repair loop keeps the title and the unit. Any other key a chart does not take, such as `$schema`, `width` or `foo`, keeps the fix that removes it, and the fixed chart draws.
