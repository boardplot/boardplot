# Boardplot plugin marketplace

This folder holds the Boardplot plugin for Claude Code and Codex, under
`plugins/boardplot/`: a chart skill and the Boardplot MCP server.

**Received `boardplot-claude-code.zip` already? Read `INSTALL.md` next to this
file.**

## Install

The repository root is the marketplace. It lists the plugin in this folder.

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

Start a new session so the skill and the MCP server load. The plugin installs
the npm package `boardplot` at its own version into a Boardplot cache folder,
so the first start of each version needs the npm registry.

For a machine without registry access, each GitHub release carries this
folder with the runtime bundled as `boardplot-claude-code.zip`.
`plugins/boardplot/SETUP.md` has both routes, the checks, the update steps
and troubleshooting.

## Without a plugin

The npm package `boardplot` ships the same MCP server as `boardplot-mcp`.
Install it with `npm install -g boardplot`; any MCP client can then start
`boardplot-mcp`. See the project README.

## Build the offline folder yourself

From a checkout of the repository:

```bash
npm ci
npm pack
node scripts/build-plugin.mjs --tarball boardplot-<version>.tgz --out <empty folder>
```

The build writes `boardplot-marketplace/`, `boardplot-claude-code.zip` and
`boardplot-cowork.zip` into that folder. Their MCP declarations start the
bundled runtime directly.
