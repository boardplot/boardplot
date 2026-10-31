# Accessibility

Boardplot gives readers who cannot see a chart a text alternative, and keyboard access in React. It makes no formal WCAG conformance claim.

## What Boardplot provides

- **Name and description:** every SVG chart has an accessible name and a description that come from the chart. `options.a11y.description` replaces the generated description with your text, in the SVG and the React components. It also replaces the sentences the chart adds for events, omitted labels and notes, so include in it what a reader must not miss.
- **Data table:** `options.a11y.table` adds a table of the chart's records in the React components. `'hidden'` keeps it for assistive technology, `'toggle'` adds a control and `'below'` shows it under the chart.
- **Keyboard:** a chart with `hover` on, or with `onRecordClick`, has one tab stop for its records. The arrow keys follow the drawn chart, Home and End go to the first and last record, and Enter or Space calls `onRecordClick`. See [Keyboard](reference/react.md#keyboard).
- **Screen readers:** the focused record uses the W3C APG listbox pattern with `aria-activedescendant`. A reader who does not enter the chart gets its name and description.
- **Colour:** a render checks the colour roles in the chart, and `validateTheme(theme)` from `boardplot/validate` checks a full theme. A finding names the measured colours, the vision mode and the floor.
- **Motion:** React stories and tables follow `prefers-reduced-motion`.

## Known barriers

- A PNG has no accessible name or description. The page that shows it must add alternative text.
- The default SVG has no data table and no keyboard access to its records. The React components add both.
- The tab stop appears after the hover engine loads, so keyboard access to records needs JavaScript.
- A generic audit can flag `role="listbox"` in the page flow. It is there on purpose. [Keyboard](reference/react.md#keyboard) gives the reason.

## Automated checks

CI runs `tests/a11y-verification.test.tsx` on every pull request. It runs named axe rules on every demo fixture and a contrast check for each theme. These checks do not replace tests with a real screen reader.

## Report a barrier

[Open an issue](https://github.com/boardplot/boardplot/issues/new/choose) with the spec, the Boardplot version, and the browser and assistive technology you used. The maintainers keep this page.
