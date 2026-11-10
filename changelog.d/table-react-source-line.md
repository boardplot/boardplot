### Fixed

- React table: the source line now follows the SVG frame's rule. A source that opens with a bold source word (`"**Source:** Company filings"`) no longer prints the word twice, and `strings.source: ''` prints the source without a leading colon. Before, the table showed `Source: **Source:** Company filings` and `: Company filings`.
