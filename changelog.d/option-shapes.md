### Added

- Accept one footnote string, source arrays joined with `; `, sort strings and `true`, a positive integer for `topN`, and a language string for `locale`. Number marks still come only from `locale.decimal` and `locale.thousands`.
- Accept an empty KPI label without a blank label or gap, an empty source prefix without a colon, and partial canvas margin objects that keep missing preset values.
- Accept a theme object containing only `overrides` against the default preset.
- Convert unsafe bare chart names into file stems with a `name-slugified` warning and a fix. Existing valid names and versioned document names keep their spelling.
- Read `valueLine.text` as `label` with an info warning and a rename fix when `label` is absent or equal. Conflicting captions and authored text on `indicator100` remain refused.
