### Changed

- The MCP server no longer loads the 1.9 MB font reader for PNG output at start: it loads it before the first `boardplot_render` call whose `format` or `outDir` asks for a PNG. The CLI loads it only for `--format png` or an `--out` file that ends in `.png`, not for any argument that contains "png". PNG bytes are unchanged.
