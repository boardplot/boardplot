### Changed

- A number prints the same text at every width, height, theme and render target. Charts that shortened a number to fit a small size now keep its full text:
  - A value heatmap and a cohort heatmap no longer shorten their numbers to fit the cells. This takes back the change of 0.55.0, where a matrix with no room dropped the % sign that the unit line names, then decimals, before it hid a number. A narrow heatmap and a narrow cohort heatmap now print no value in their cells where a value does not fit, and the cells keep their colour. The key, the hover card and the description keep the values.
  - A narrow stacked column chart printed its totals short, such as `10.1k`. It now prints `10,089`, and a total with no room moves to the note with that text.
  - A cohort exhibit or a dimension switch that leaves out periods on a narrow card printed the remaining values with other decimals: `68.4` where the full table printed `68`, and `1.8k` where it printed `1.80k`. The card now prints each value as the full table does.
  - A dimension switch folded to fit a fixed height, such as a slide, set the decimals of its changes from the rows it draws. It now sets them from every row, as the open table does.
- To keep numbers on a narrow chart, set a format with fewer digits. It holds at every size: `format: "0"` prints whole numbers in every cell of a heatmap, and `format: "1.2k"` prints totals such as `10.1k` above the columns of a stacked column chart.

### Removed

- `options.fitFormats` on a table or dimension switch, and `fitFormat` on table columns and rows. They shortened a format until the widest figure fit an authored track, so a table printed `$2.5M` on a phone and `$2.47M` on a laptop, and a dimension switch printed `−54%` on a slide where a report printed `−54.1%`. A table now prints the format it was given at every width, and a value track widens to hold its widest figure. Below the table's smallest width, the CLI and the MCP tool refuse the size and name the width it needs, and React scrolls. An old spec still draws and warns `option-deprecated` with a remove patch. To print fewer digits, set a shorter format example, such as `$1.2M` for `$1.23M`.
- The React prop `onFormatsFit` is deprecated and never called. The info warning `table-formats-fitted` is gone.
- The fixture `table/fit-formats-narrow-tracks` is now `table/narrow-tracks-widen`, without the option.
