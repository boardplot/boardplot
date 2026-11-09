# Boardplot in a generic MCP client

Add Boardplot as a local stdio server when the client does not install the Boardplot plugin. Node.js 22.12 or newer is required.

## npm installation

Install the package once:

```sh
npm install -g boardplot
```

Add the server to the client's MCP configuration:

```json
{
  "mcpServers": {
    "boardplot": { "command": "boardplot-mcp" }
  }
}
```

Restart the client. The server exposes six tools: `boardplot_list`, `boardplot_describe`, `boardplot_fixtures`, `boardplot_measure`, `boardplot_render` and `boardplot_feedback`. Render validates the spec while drawing. Feedback drafts a report and sends nothing.

## Offline ZIP installation

The included `stdio-config.json` is for the offline release ZIP, which bundles the runtime and its production dependencies.

1. Copy `stdio-config.json` into the client's MCP configuration.
2. Replace `/absolute/path/to/boardplot-marketplace` with the absolute path to the extracted marketplace directory.
3. Restart the client and confirm that the six tools are listed.

The server entry is `plugins/boardplot/runtime/dist/mcp/server.js` inside the extracted marketplace. Normal operation is offline. The server writes only MCP protocol messages to stdout.

Boardplot is licensed under Apache-2.0. The plugin folder contains `LICENSE.txt` and `THIRD_PARTY_NOTICES.md`.
