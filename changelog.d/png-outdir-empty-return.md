### Changed

- An MCP render with `format: "png"`, `outDir` and `return: []` sends no image block: the answer names the written files in `outputs` and no longer repeats the PNG bytes as base64 (about 296 KB for one map). A call without `return` still returns the image block.
