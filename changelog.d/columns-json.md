### Changed

- CLI `--columns` also takes a JSON object, the same one the MCP tool's `columns` argument takes: `--columns '{"category":"month","series":"segment","value":"revenue"}'` draws the same chart as `--columns category=month,series=segment,value=revenue`. A JSON value that is not an object of strings is refused with `invalid-argument`.
