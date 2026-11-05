### Added

- Table and dimswitch `paintOffscreenRows: true` paints every mounted row at once, so a capture of a long table has no blank rows. It turns off the deferred paint and the row paging over 500 rows. A long table paints slower, and closed rows still follow `mountCollapsed`. Example: `{"options": {"paintOffscreenRows": true}}`. The host CSS workaround in the docs is no longer needed.
- Table and dimswitch `rowLabelLines` takes any positive whole number, not only 1 or 2. Track widths, row heights and the React grid follow the count. Example: `{"options": {"rowLabelLines": 3}}`.
