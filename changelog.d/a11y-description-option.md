### Fixed

- An author can now write the accessible description of a chart. `options.a11y.description` replaces the generated description in the SVG `<desc>` element and in the React chart, for every chart type. The generated text stays the default. The sentences the chart adds for events, omitted labels and notes belong to the generated text, so the author's text replaces them too. An empty string is refused with `invalid-options`.
