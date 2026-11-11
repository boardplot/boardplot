---
name: boardplot-chart
description: Draw consulting-grade charts, tables and maps as SVG or PNG with Boardplot, or build Boardplot React chart components. Use when the user requests a chart, graph, table exhibit, map or chart component.
---

# Boardplot charts

Use the Boardplot MCP tools for chart images. Tool names may have a host prefix. Match the `boardplot_` tool names.

## Choose the next call

- **Valid spec supplied:** call `boardplot_render` directly.
- **Known chart type, unfamiliar fields:** call `boardplot_describe` with `type`. Start from its example. Compact responses name accepted shared options and define `cell` and annotation anchors when used.
- **Uncertain chart type:** call `boardplot_list` for types, use cases and supported alternatives.
- **Example needed:** call `boardplot_fixtures` with `type`, then retrieve the chosen `id` with the same `type`. Listings are paginated.
- **One field unclear or cut off with …:** call `boardplot_describe` with `type` and `path`, such as `options.valueAxis.break`. Reserve `detail: "full"` for the whole contract of the type's own fields. If the response includes `design`, request `path: "design"` when the design decision needs its full guidance.
- **Fixed container or size refusal:** call `boardplot_measure` with the spec and width. Use its measured size. [Sizing](references/manual.md#sizing) explains targets and units.

When the chart supports row mapping, pass the user's data file as `rowsFile` with `columns`. Keep required template metadata such as map packs and table columns. Other data shapes go in `spec.data`. The `columns` argument of `boardplot_render` lists the roles each chart needs. The CLI takes the same roles as `--columns category=c,series=s,value=v`.

Read `ok`, `warnings`, `reading` and the actual returned format before using a render. PNG can fall back to SVG. Follow error `fix` or `suggest` for a refusal. [Errors and warnings](references/manual.md#reading-errors-and-warnings) and [PNG output](references/manual.md#png-output) cover repairs. Set `outDir` when files are needed, or request `return: ["reading", "svg"]` for inline SVG. With `outDir`, `return: []` leaves the reading out of the answer, and `outputs` names the written files.

## Match the destination

Change only the charts the user requests. Boardplot draws charts. Use the destination's authoring tool to place them in a deck, page or report.

| Destination | Settings and reference |
|---|---|
| PowerPoint or Keynote | `target: "slide"`, picture-box size in pt, PNG at default `scale: 2`. PowerPoint also accepts SVG. [Deck guidance](references/use-cases.md#powerpoint-or-keynote-deck) |
| HTML page | `return: ["reading", "svg"]`, SVG inline. Use computed values from `reading` where the text discusses those values. [Analysis pages](references/use-cases.md#analysis-page-or-claude-artifact) |
| React or Next.js | Per-type components with `size="container"` under `BoardplotTheme`. Use `target="dashboard"` and server `prepareChart` for Next.js. Inspect the component's warnings and refusals. [React reference](references/reference/react.md) |
| Word or PDF | `target: "print"`, text-column width in mm, PNG at `scale: 3.125` for 300 dpi. [Print reports](references/use-cases.md#word-or-pdf-report) |
| Recurring report | Reuse a spec template with each new export. [Recurring reports](references/use-cases.md#recurring-report) |

Use the user's brand colours through a theme. The default theme is Bridge. [Theme reference](references/reference/theme.md) covers presets and overrides. Fonts must be installed for PNG rendering and loaded where SVG is displayed. [Custom fonts](references/FONTS.md) covers brand fonts. Transparent output retains the theme background colour in label halos, so use a matching display surface.

## CLI fallback and feedback

When MCP is unavailable, use the plugin launcher described in [CLI without PATH](../../SETUP.md#cli-without-path). The plugin adds no `boardplot` command. An existing command may belong to another install. Compare its version with the MCP response before mixing them.

When Boardplot fails, refuses valid input or draws something misleading, offer `boardplot_feedback`. Keep client names, numbers, labels and paths out of the summary. Show the draft and `issueUrl` to the user. Submit a report or enable telemetry only when the user asks.
