---
name: boardplot-chart
description: Draws consulting-grade charts, tables and maps as SVG or PNG from a JSON spec through the boardplot MCP tools or the boardplot CLI, and generates the React component for a chart. Use when the user asks for a chart, graph, table exhibit, map or a React chart component.
---

# Boardplot charts

Before the first chart, read [references/manual.md](references/manual.md): the Boardplot manual. It covers the spec, the chart types, sizing, themes, the MCP tools, the CLI and the React components.

The MCP tools come first. They appear with a host prefix; match on the suffix `boardplot_list`, `boardplot_describe`, `boardplot_render`, `boardplot_measure`, `boardplot_fixtures`, `boardplot_feedback`. `boardplot_describe` with `detail: "full"` returns the whole reference of a chart type. Before the first chart of a type that has a design card (bar, line, waterfall), read its card with `boardplot_describe` and `path: "design"`.

The plugin root is the directory two levels above this file. The plugin adds no `boardplot` command. If `boardplot --version` works, another install provides it: compare its version with the `version` field the MCP tools return before you use it. Otherwise run the CLI of the manual as `node <plugin root>/scripts/boardplot.mjs <verb> ...` from the folder the paths are relative to. It runs the Boardplot version of this plugin: the bundled runtime of the offline ZIP install, else the matching npm package, which it installs once into a Boardplot cache folder. The manual's links to reference pages resolve in the offline ZIP install only.

When Boardplot itself fails, refuses wrongly or draws something misleading, offer the user a problem report with `boardplot_feedback`. Write its summary without client names, numbers, labels or file paths. Show the user the report and `issueUrl`; the user decides whether to submit it. Never submit or send a report without the user's yes, and never run `boardplot telemetry on` unless the user asks for it.
