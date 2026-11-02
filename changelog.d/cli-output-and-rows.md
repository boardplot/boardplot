### Added

- `boardplot render --out -` writes the one chart to stdout (the SVG text, or the PNG bytes with `--format png`) and prints the JSON answer on stderr, so `boardplot render spec.json --out - > chart.svg` works.
- A rows file can be tab-separated. `--rows` and `rowsFile` read `.tsv` and `.txt` files besides `.json` and `.csv`, and a `.csv` whose header line holds more tabs than commas and semicolons is read as tab-separated. A tab-separated file keeps the dot as its decimal mark.

### Changed / may need action

- A rows file may now hold up to 10 MB (was 2 MB), the size of a request the MCP server accepts. A histogram or box chart of several hundred thousand observations can come from a file.
- A new `--out` path that ends in a file extension other than `.png` or `.svg`, such as `chart.jpg` or `chart.pdf`, is refused with `invalid-argument`. It used to become a folder with that name. End the path with `/` to keep making a folder of that name. The MCP `outDir` argument follows the same rule.

### Fixed

- The manual no longer says that the React export writes PDF. It writes SVG, PNG and CSV; the manual now names printing from the browser for a PDF.
