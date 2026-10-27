# Next.js server rendering example

Requires Node.js 22.12 or newer. Uses fixed Next.js and React versions, with no framework dependency added to the library.

Install the example dependencies and a locally packed Boardplot tarball:

```sh
cd tests/next-app
npm install
npm install --no-save --package-lock=false /path/to/boardplot-VERSION.tgz
npm run build
npm start
```

Replace the tarball path with the output of the repository's package workflow. Open [localhost:3000](http://localhost:3000). Install the tarball again after reinstalling dependencies. The example deliberately does not save a machine-specific tarball path or lockfile.

`app/page.jsx` is a Server Component. It parses a generic chart document and prepares both charts with explicit sizes. `app/prepared-charts.jsx` is the client boundary and attaches the prepared SVG and HTML table. Table expansion remains interactive. Keep event handlers inside the client component.

Both original chart props and prepared output reach the browser. Never pass source secrets, credentials or confidential suppressed values to these props. Prepared output is not a substitute for filtering data on the server.

From the repository root, run `npm run smoke:next -- --tarball /path/to/boardplot-VERSION.tgz`. It installs into a temporary copy, builds, starts on a free local port and checks that the first response includes an SVG, a styled table and its collapsed row control. The pass line prints the Next, React and Node versions it loaded. CI runs this with Node 22 after package smoke, using this example's React 19.3.0. React 18 is unsupported here because Next 16 is pinned to React 19. Use `--artifacts /path/to/empty-directory` to retain the built example for browser inspection. The browser check confirms clean hydration and that expanding the table reveals North and South. That inspection is the visual review, not a CI gate.
