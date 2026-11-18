### Fixed

- A theme override that sets only some fields of the secondary or micro text role, such as `{ type: { secondary: { weight: 700 } } }` for bold category labels, no longer refuses the chart with `invalid-theme-override` when the theme does not define that role. The fields the override leaves out keep the values the chart draws without it, after the rest of the same override applies, at every width. An override that already set both size and weight draws as before. The `ThemeOverrides` type accepts these partial roles.
