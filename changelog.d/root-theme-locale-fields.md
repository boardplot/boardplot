### Fixed

- A spec-root `theme` that is not a string or an object (`null`, a number, a boolean, an array) is refused with `invalid-theme` at `/theme`. `null` failed with `layout-error` "Cannot read properties of null", and the other values were ignored without a message.
- A root `locale` object on a bare chart gets the fix that moves it into `options.locale`, so the authored decimal mark is kept. The fix removed it. Object and array `subtitle` and `source` values move the same way, and the root `locale-ignored` warning of an envelope names `options.locale` as the place for a locale object.
