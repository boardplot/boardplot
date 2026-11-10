### Fixed

- Bar: a theme's `marks.barLabels: 'outside'` on a stacked or stacked100 bar now warns `option-ignored`. A stack prints each part inside its segment, so the setting changes nothing there. Set in `theme.overrides`, it warns with a patch that removes it. Set by a registered theme, it reports at info level without a patch. Grouped bars are unchanged.
