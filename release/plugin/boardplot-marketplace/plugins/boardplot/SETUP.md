# Setup

## Requirements

- Node.js 22.12 or newer on the machine that starts the runtime, with
  `node` and `npm` on PATH.
- Claude Code with plugin marketplace support, or the Codex CLI with plugin
  marketplace support.
- A local session. The MCP server runs on your machine, so a cloud-only
  session cannot start it.

There are two routes. Use one of them, not both: each one registers a
marketplace named `boardplot`.

| Route | Network | PNG |
|---|---|---|
| Marketplace (main route) | git reaches GitHub at install; npm reaches the registry at the first start of each version | Works without a browser: npm installs the optional `@resvg/resvg-js` |
| Offline ZIP | Only the download of the ZIP | Needs Chrome or Chromium; without one, a PNG request returns SVG with the warning `no-rasterizer` |

## Marketplace route

### Claude Code

```bash
claude plugin marketplace add boardplot/boardplot
claude plugin install boardplot@boardplot
```

Start a new Claude Code session. Check the plugin:

```bash
claude plugin details boardplot
```

Expected inventory:

```text
Skills (1)
MCP servers (1)  boardplot
```

In Claude Code, open `/mcp` and check that the Boardplot server is
connected. The first start can take a moment while npm downloads the
package. The server has the tools list, describe, fixtures, measure,
render and feedback.

End-to-end check:

```text
Use the boardplot-chart skill. Create a small column chart from realistic sample
data, write the JSON source into a new working directory and render it as SVG
and PNG. Return the source path, the file paths and the derived numbers the
render reports.
```

Expected result: the render succeeds, the SVG and PNG files exist, and the
result carries a `reading` with the derived numbers.

### Codex

```bash
codex plugin marketplace add boardplot/boardplot
codex plugin add boardplot@boardplot
```

Start a new Codex task and ask it to use the `boardplot-chart` skill to
render a small column chart. Check that the tools `boardplot_list`,
`boardplot_describe`, `boardplot_fixtures`, `boardplot_measure` and
`boardplot_render` are there.

### Update

Each plugin version starts the npm package of the same version, so an
update of the plugin also updates the runtime.

Claude Code installs a copy of each version. Read the new marketplace and
install the new version:

```bash
claude plugin marketplace update boardplot
claude plugin update boardplot@boardplot
```

Then start a new session, or run `/reload-plugins`.

Codex keeps a copy of each version. Read the new marketplace, install the
new version, then start a new task:

```bash
codex plugin marketplace upgrade boardplot
codex plugin add boardplot@boardplot
```

## Offline ZIP route

Each GitHub release of `boardplot/boardplot` has two ZIP files with the
runtime bundled:

- `boardplot-claude-code.zip`: the marketplace folder
  `boardplot-marketplace/`, for Claude Code and Codex.
- `boardplot-cowork.zip`: the bare plugin, for a host that installs a plugin
  from an uploaded file.

After the install, this route needs no network access. Unzip the
marketplace to a folder you keep. The install points at it.

```bash
mkdir -p ~/boardplot && cd ~/boardplot
curl -LO https://github.com/boardplot/boardplot/releases/latest/download/boardplot-claude-code.zip
unzip -o boardplot-claude-code.zip
```

Claude Code:

```bash
claude plugin marketplace add ~/boardplot/boardplot-marketplace
claude plugin install boardplot@boardplot
```

Codex:

```bash
codex plugin marketplace add ~/boardplot/boardplot-marketplace
codex plugin add boardplot@boardplot
```

The checks are the same as on the marketplace route.

### Update

Download and unzip the new release into the same folder, as above.

Claude Code installs a copy of each version. Read the new version from the
folder and install it:

```bash
claude plugin marketplace update boardplot
claude plugin update boardplot@boardplot
```

Then start a new session, or run `/reload-plugins`.

Codex keeps a copy of each version. Install the new one, then start a new
task:

```bash
codex plugin add boardplot@boardplot
```

## CLI without PATH

The plugin puts nothing on PATH. Each verb of the CLI is also an MCP tool.
Prefer the tools; they need no path.

On both routes, call the plugin's launcher by its path. It runs the
Boardplot version of the plugin: the bundled runtime on the offline ZIP
route, else the npm package it keeps in `~/.cache/boardplot/plugin-runtime/` (`$XDG_CACHE_HOME` when set; `%LOCALAPPDATA%\\boardplot\\plugin-runtime\\` on Windows). The plugin root is the
folder that holds `skills/` and `scripts/`, two levels above the skill's
`SKILL.md`. Relative paths are relative to the folder you run it in.

```bash
BOARDPLOT_PLUGIN_ROOT=<installed plugin folder>
BOARDPLOT_CLI="$BOARDPLOT_PLUGIN_ROOT/scripts/boardplot.mjs"

node "$BOARDPLOT_CLI" list
node "$BOARDPLOT_CLI" fixtures --type column
node "$BOARDPLOT_CLI" render chart.json --out out/
```

In a Claude Code Bash tool, `$CLAUDE_PLUGIN_ROOT` names the plugin root. A
plain terminal does not set it; Claude Code records the installed folder in
`<config folder>/plugins/installed_plugins.json`.

## Troubleshooting

### `boardplot: command not found`

Expected. The plugin adds nothing to PATH. Use the MCP tools, or the CLI
from [CLI without PATH](#cli-without-path).

### `node` or `npm`: command not found

Install Node.js 22.12 or newer. It brings `npm`. The plugin does not bundle
Node.js itself.

### The MCP server does not start on the marketplace route

The first start of each version runs `npm install` in the cache folder,
which needs the npm registry. The launcher prints npm's error. Check that
`node <plugin root>/scripts/boardplot.mjs --version` works in a terminal.
npm uses your user-level npm settings (`~/.npmrc`), never the settings of a
project folder: put a company registry or proxy there. Without registry
access, use the offline ZIP route.

### `marketplace add` fails to clone

Claude Code tries SSH first for `boardplot/boardplot`. On a machine without
a GitHub SSH key, set `CLAUDE_CODE_PLUGIN_PREFER_HTTPS=1`, or add the
marketplace by its URL: `https://github.com/boardplot/boardplot.git`.

### PNG request returns SVG with `no-rasterizer`

On the marketplace route, npm could not install `@resvg/resvg-js` for your
platform. On the offline ZIP route, no Chrome or Chromium was found. Install
one of them, or set `BOARDPLOT_CHROME_PATH` to the browser binary.

### No `boardplot_` tools in Codex

Run `codex mcp list --json` and check the `boardplot` server. Its `cwd`
must be the installed plugin folder, ending in `/.`.
Until the tools show, the CLI route above works.

### Native Windows

Both routes start the MCP server with `node`. On the marketplace route the
launcher calls `npm.cmd` through a shell on Windows. Neither route has been
tested on native Windows. If the server does not start there, run the host
in WSL.

### MCP server missing or disabled

Check that the session runs on your machine, and that no device policy
turns off local MCP servers.

### Plugin updated but the old server still runs

Run the Claude Code update commands of your route, then run
`/reload-plugins` or start a new session.
