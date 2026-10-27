# Generic stdio MCP fallback

Use this for an MCP host that does not install Claude plugins.

1. Copy `stdio-config.json` into the host's MCP configuration.
2. Replace `/absolute/path/to/boardplot-marketplace` with the absolute path to
   this release's marketplace directory.
3. Restart the host and confirm the Boardplot tools are listed.

The server entry is `plugins/boardplot/runtime/dist/mcp/server.js` in the
marketplace directory. The server uses stdio. It writes only MCP protocol
messages to stdout. It needs Node.js 22.12 or newer. The runtime and its
production dependencies are bundled. Normal operation is offline and does not
use `npx`.

Expected capabilities:

- list and describe chart types;
- validate and render chart documents.

Boardplot is licensed under Apache-2.0. See `LICENSE.txt` in the plugin folder.
See `THIRD_PARTY_NOTICES.md` in the same folder for bundled software and font notices.
