### Fixed

- A React chart that gets `rows` draws in a Vite 8 production build. Before, it stayed on the busy placeholder: Rolldown wrote the rows chunk as an empty file, because the chunk published the rows transform only through a module-scope call and `sideEffects` did not list it. The rows chunk, the annotation engine and the patched-theme checks now load through the exports of their chunk, which no bundler drops. A chunk that loads and still publishes nothing shows the load-failure card instead of the busy placeholder. No golden changes.
