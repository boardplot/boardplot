### Added

- Plain numeric strings and boolean option strings, numeric data ids, and unique case-insensitive chart names and enum values draw with an `input-converted` warning and a JSON Patch fix. Ambiguous numbers, units and values with more than 15 significant digits stay refused.
- Table status cells accept green, amber, yellow and red, and status keys in any case. Scenario `LY` means `PY` (last year), in any case. Conversions warn `input-converted` with a fix.
- MCP render and measure accept an object spec sent as a JSON string and warn `spec-parsed-from-string`. An explicit SVG format without return or an output path includes the drawing and warns `svg-returned`; an omitted format keeps the reading-only response.
