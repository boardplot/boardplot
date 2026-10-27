# Changelog

Boardplot is in 0.x: options and output can change between minor versions. Each release lists its changes here.

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
