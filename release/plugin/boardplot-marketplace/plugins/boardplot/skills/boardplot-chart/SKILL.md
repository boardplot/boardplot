---
name: boardplot-chart
description: Draws consulting-grade charts, tables and maps as SVG or PNG from a JSON spec through the boardplot MCP tools or the boardplot CLI, and generates the React component for a chart. Use when the user asks for a chart, graph, table exhibit, map or a React chart component.
---

# Boardplot charts

Before the first chart, read [references/manual.md](references/manual.md): the Boardplot manual. It covers the spec, the chart types, sizing, themes, the MCP tools, the CLI and the React components.

The MCP tools come first. They appear with a host prefix; match on the suffix `boardplot_list`, `boardplot_describe`, `boardplot_render`, `boardplot_measure`, `boardplot_fixtures`, `boardplot_feedback`. `boardplot_describe` with `detail: "full"` returns the whole reference of a chart type. Before the first chart of a type that has a design card (bar, line, waterfall), read its card with `boardplot_describe` and `path: "design"`.

The plugin root is the directory two levels above this file. The plugin adds no `boardplot` command. If `boardplot --version` works, another install provides it: compare its version with the `version` field the MCP tools return before you use it. Otherwise run the CLI of the manual as `node <plugin root>/scripts/boardplot.mjs <verb> ...` from the folder the paths are relative to. It runs the Boardplot version of this plugin: the bundled runtime of the offline ZIP install, else the matching npm package, which it installs once into a Boardplot cache folder. The manual's links to reference pages resolve in the offline ZIP install only.

Deliver the chart in the form its destination takes. Set the `target` and the slot size of that destination, and read the warnings before you hand the chart on.

- Slides (PowerPoint, Keynote, Google Slides): PNG with `target: "slide"` and the picture box size in pt. The default `scale` 2 places at the box size. Google Slides takes no SVG.
- Word or PDF reports: PNG with `target: "print"`, the text column width in mm and `scale` 3.125 for 300 dpi.
- HTML report or wiki page (Confluence, Notion, a GitHub README): SVG at the column width, or PNG where the wiki takes no SVG.
- React or Next.js dashboard: the per-type components with `size="container"` under `BoardplotTheme` with `target: "dashboard"`. Generate the component code.
- Scheduled report: a spec template and the CLI with `--rows`, `--format png` and a dated `--out` folder. The job fails on a non-zero exit code.
- Recurring report written by an agent: `boardplot_render` with `rowsFile` and `columns`. Repair a refusal from each error's `fix` or `suggest`.

The fonts must be installed where a PNG is drawn and loaded where an SVG is shown. `background: "transparent"` keeps the theme colour in label halos, so use it only on a surface of that colour. The Use cases page, linked at the top of the manual, has the full recipe for each destination.

When Boardplot itself fails, refuses wrongly or draws something misleading, offer the user a problem report with `boardplot_feedback`. Write its summary without client names, numbers, labels or file paths. Show the user the report and `issueUrl`; the user decides whether to submit it. Never submit or send a report without the user's yes, and never run `boardplot telemetry on` unless the user asks for it.
