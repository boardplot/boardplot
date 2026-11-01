### Fixed

- The React manual now explains that `renderToString` writes the loading fallback for a refused or empty chart whose card has not loaded. Hydration reports React error 419 in production before the client draws the card. Use `renderToPipeableStream` to wait for the card on the server.
