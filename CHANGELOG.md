# Changelog

Boardplot is in 0.x: options and output can change between minor versions. Each release lists its changes here.

## 0.53.0

### Added

- Gantt:
  - `options.calendar`. `weeks: 'startDay'` names the day each week starts on, and `span: 'data'` runs the timeline from the first item to the last. The defaults keep the old head.
  - A row takes `sublabel`, a muted second line under the row name.
  - An item takes `kind: 'rule'`, a quiet line for the state before a change.
  - An event takes `labelPlacement: 'badge'`, a label of up to 3 characters in a filled circle at the top of its rule.
  - A `cols` cell object no longer needs `tone`.
  - New example fixture `status-timeline`.
- `table`, `bartable`, `histogram` and `box` draw from rows in the CLI (`--rows`), the MCP tools (`rows`, `rowsFile`) and `specFromRows`.
- React: `BoardplotChart` takes `onSpecError`, and `onRowSelect` and `isRowSelectable` for a `table` spec.
- Boardplot for Python in `python/`. `bp.chart(df, ...)` draws the same SVG as the CLI in a notebook or a script without Node, and `bp.st_chart` draws a chart in Streamlit. It is not on PyPI yet.

### Changed

- Gantt event rules and the today line no longer hide span names. A name crosses the rule, and the rule breaks around it. No option brings back the old behaviour, which only hid labels.
- A gantt event rule at a date or at a bar, chevron, bracket or shade id draws on the start edge of its day, not the middle. Rules at a milestone or a cadence event, and the today line, stay in the middle.
- Percent cells keep their "%" on bar, dot and funnel value labels. A value axis of percent cells prints "%" on its ticks.
- Schema errors for a union with a literal tag report the branch the spec meant, and report identical issues once.

### Fixed

- A data ID named like an `Object.prototype` member (`__proto__`, `constructor`, `toString`, `hasOwnProperty`, `valueOf`) caused wrong numbers, wrong refusals or lost keyed values. It now draws like any other ID.
- A percent mekko of shares with no amount printed a column total of "0".
- Text measurement gives default-ignorable code points (soft hyphen, zero-width space, word joiner, BOM) no width, as browsers draw them. `boardplot fonts build` writes a negative advance as 0. Rebuild host tables made with an earlier version.
- Number formats and colours parse in linear time. Long malformed input was slow.

## 0.52.5

First public release.

- 37 chart types from one JSON spec, among them bar, column, line, waterfall, mekko, scatter, tables, Gantt charts and maps.
- Output as deterministic SVG, as PNG and as React components; the same spec gives the same SVG, byte for byte.
- One collision solver places every label. A chart that does not fit is refused with the size it needs.
- Totals, differences, shares and growth rates are computed from the data, and each render reports them.
- Four targets (`report`, `dashboard`, `slide`, `print`) set the type sizes for the medium.
- Theme presets, custom themes and contrast checks; width tables for Geist, Helvetica and Arial (Helvetica Neue is measured with the Helvetica widths), and `boardplot fonts build` for a licensed font.
- Map packs for the world, Europe, the EU-27, the US states, the DACH countries and the German states.
- The `boardplot` CLI and the `boardplot-mcp` server with six MCP tools: list, describe, fixtures, measure, render and feedback.
- A plugin for Claude Code and Codex with a chart skill and the bundled runtime.
- Complete example specs (fixtures) for every chart type.
