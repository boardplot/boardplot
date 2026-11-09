# Boardplot plugin

This plugin brings Boardplot to Claude Code and Codex. It has:

- the Boardplot MCP tools, started from the manifest of each host. This is
  the main route;
- one skill for charts, `boardplot-chart`, with local references loaded as needed;
- the Boardplot CLI as a fallback. The plugin adds no `boardplot` command;
  the skill says how to call the CLI.

The runtime draws consulting-grade SVG and PNG charts and reports, for each
chart, the numbers it derived and the labels it placed.

## Install

The repository `boardplot/boardplot` is a plugin marketplace.

Claude Code:

```bash
claude plugin marketplace add boardplot/boardplot
claude plugin install boardplot@boardplot
```

Codex:

```bash
codex plugin marketplace add boardplot/boardplot
codex plugin add boardplot@boardplot
```

Then start a new session and ask:

```text
Use Boardplot to create a column chart from realistic sample data,
and render it to SVG and PNG.
```

The MCP server is the npm package `boardplot` at the plugin's exact
version. The plugin's launcher, `scripts/boardplot.mjs`, installs it once
into a Boardplot cache folder, together with the optional
`@resvg/resvg-js`, which draws PNG files without a browser. npm runs in
that cache folder, so the npm settings of the project you work in never
apply; your own user-level npm settings do.

For a machine without access to the npm registry, use the offline ZIP.
[Setup](SETUP.md) covers installation, updates and troubleshooting.

## Runtime contract

- The runtime needs Node.js 22.12 or newer, with `node` and `npm` on PATH.
- Marketplace install: the first start of each version needs the npm
  registry. The package then stays in the cache folder.
- Offline ZIP install: the plugin bundles the runtime and its production
  dependencies, and nothing is fetched. PNG needs Chrome or Chromium on that
  route; without one, a PNG request returns SVG with the warning
  `no-rasterizer`.
- Rendering, schemas and docs are local on both routes.

## Licence

Boardplot is licensed under the Apache License, Version 2.0. See
`LICENSE.txt`.
