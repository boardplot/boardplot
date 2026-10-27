# Boardplot hosted MCP server (prototype)

A remote MCP server that a business user's AI host calls over Streamable HTTP.
It renders Boardplot charts on the server and shows them in an MCP Apps view.
It is not part of the `boardplot` npm package and is never published.

Status: localhost prototype. No sign-in, no deployment.

## What it offers

| Tool | Who sees it | What it does |
|---|---|---|
| `boardplot_describe` | model | Lists chart types, or the data roles, options, limits and one example for one type. |
| `boardplot_chart` | model and view | Renders rows, CSV text or a spec. Returns a short reading, the view data in `_meta`, and a preview PNG for a client without MCP Apps. |
| `boardplot_export` | model | Returns SVG, or PNG at exactly 2×, in the light or dark scheme. |
| `boardplot_view` | view only | Returns the view data at a new frame size or for one scheme (re-layout, dark drawing, recovery). |

All four tools are read-only, idempotent and closed-world. Errors come back as `isError: true` with the CLI error shape (`code`, `path`, `message`, `suggest`, `fix`).

The view is one inline HTML resource, `ui://boardplot/chart-v1.html` (`text/html;profile=mcp-app`). It loads nothing from the network.

## Build and run

The server bundles the engine from `../src`, so install the repository first.

```bash
npm ci                 # in the repository root
cd server
npm ci
npm run build          # writes dist/index.mjs, dist/worker.mjs and dist/view.html
npm start              # listens on http://127.0.0.1:3001/mcp
```

Environment variables:

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `3001` | Port on 127.0.0.1. The server never binds to another address. |
| `BOARDPLOT_DEADLINE_MS` | `10000` | Render deadline. A render past it is stopped: its child process is killed and replaced. |
| `BOARDPLOT_WORKERS` | `2` | Number of render child processes. |
| `BOARDPLOT_DEBUG` | unset | `1` logs the method and protocol version of each request (no content). |

Limits: 1 MiB request body, 2,000 rows, 20,000 cells (for rows, CSV and spec data), PNG side 4,000 px, chart and view results 100,000 characters, export result 120,000 characters. A job that waits longer than one deadline for a free render process gets `server-busy`.

PNG output needs `@resvg/resvg-js` and a font for the theme; without them a PNG answers `png-unavailable`. The server never starts a browser.

The dark default and the dark fallback is `glass` with the boardroom type family. At startup the server checks that both safe themes (`boardroom` and that dark theme) pass every colour floor, and refuses to start if one does not. A preset or spec theme with a floor finding draws the safe theme of its scheme, with a `theme-replaced` warning.

## Check it locally

- Tests and types:

  ```bash
  npm run typecheck
  npm test               # builds first, then runs the vitest files in test/
  ```

  CI runs the same checks in `.github/workflows/server.yml` when a change touches `server/`.

- MCP Inspector, CLI mode:

  ```bash
  npx @modelcontextprotocol/inspector --cli http://127.0.0.1:3001/mcp --transport http --method tools/list
  npx @modelcontextprotocol/inspector --cli http://127.0.0.1:3001/mcp --transport http \
    --method tools/call --tool-name boardplot_chart --tool-arg type=column \
    --tool-arg 'rows=[{"Region":"North","Revenue":42},{"Region":"South","Revenue":37.5}]' \
    --tool-arg 'columns={"category":"Region","value":"Revenue"}'
  ```

- The view: clone `https://github.com/modelcontextprotocol/ext-apps` outside this repository and run `examples/basic-host` with `SERVERS='["http://localhost:3001/mcp"]'`. That host does not declare `ui/download-file`, so the view hides "Download PNG" there; full screen then shows the PNG and the SVG as images to save. "Add to slides" stays hidden until the server offers a slides export.

- Claude Code in the terminal (no view; it gets the reading and a preview PNG):

  ```json
  { "mcpServers": { "boardplot": { "type": "http", "url": "http://localhost:3001/mcp" } } }
  ```

  ```bash
  claude -p --mcp-config mcp.json --strict-mcp-config --allowedTools mcp__boardplot__boardplot_chart "Draw a column chart from: North 42, South 37.5, East 51."
  ```

## Layout

| Path | Content |
|---|---|
| `src/index.ts` | HTTP entry: localhost only, `/mcp` and `/health`, body limit, stateless MCP handler. |
| `src/mcp.ts` | The four tools and the view resource. |
| `src/render.ts` | Pool of render child processes with the deadline. |
| `src/worker.ts`, `src/engine.ts` | Child process entry and the engine calls (render, measure, describe, rows, raster). |
| `src/csv.ts` | CSV parser: delimiter and decimal mark, missing values, refused rows. |
| `src/brand.ts` | Brand colours on a preset, with contrast repair or the whole preset. |
| `src/view/` | The MCP Apps view: HTML, CSS and a small bridge without a framework. |
| `test/` | vitest files: SVG parity with the CLI, CSV numbers, tool metadata. |
