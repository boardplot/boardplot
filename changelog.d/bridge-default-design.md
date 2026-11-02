### Changed / may need action

The default design system is now Bridge. The light default changes from `boardroom` to `bridge`. The dark pair changes from `standard-dark` to `bridge-dark`.

Bridge uses navy ink, one cobalt accent and a slate neutral. Its categorical colours run in this order: navy, blue, slate, ochre, plum, teal, orange and violet. Every data mark has at least 3:1 contrast on its page. Status and Gantt colours stay apart in greyscale. Titles are semibold. Stacks use a four-step blue ramp.

Use `theme: "boardroom"` for the old light look or `theme: "standard-dark"` for the old dark look. A spec can also set `"theme": { "preset": "boardroom" }`.

`bridge-dark` is a dark-scheme preset that a host passes itself. The preset does not switch automatically.
