# Boardplot in a Claude Dashboard (experiment)

A build of the engine's core render path for one chart type (column) as
classic scripts, for a Claude Dashboard page. The page has no network, no
modules and no React; its scripts run in order and share through `window`.
A store document holds at most 262,144 bytes of `{"text": ...}` serialized as
JSON in UTF-8, so the build splits the bundle into files of at most 250,000
serialized bytes each.

## Build

```sh
node scripts/dashboard/build.mjs --out <dir>
```

`build.mjs` writes into `<dir>` (default `artifacts/dashboard`, ignored by git):

- `bp-1.js` ... `boardplot.js`: the runtime. Each file is Rollup AMD output
  that calls `BoardplotDefine(id, deps, factory)`. The first file starts
  with the loader (a few hundred bytes), which also sets zod's `jitless`
  flag, so zod never generates code. The last file ends with
  `window.Boardplot = BoardplotRequire("boardplot")`.
- `draw.js` and `index.html`: the page script and the page fragment.
  The build replaces the `<!-- boardplot scripts -->` line with the script
  tags in load order.
- `docs/<file>.json`: the store document `{"text": ...}` of each file, for
  `ArtifactData` `set` with `file_path` (`files/<file>`).
- `load-order.json`: the script order.
- `.boardplot-dashboard-build.json`: the list of files this build wrote. The
  next build removes only those files. It refuses a folder that holds files
  but no such list, and a list that names a path outside the folder.

The split follows the modules' execution order. It cuts only where no import
crosses the cut backwards, so an import cycle stays inside one file and each
file needs only the files before it. The build stops when a file stays above
the limit.

## What the runtime does

`window.Boardplot` has `specFromRows`, `render(spec, { idScope })` and
`themeFindings(theme, spec)`.

`render` follows the CLI's static render: parse the document, validate the
chart, resolve the request, lay out and serialize. It leaves out the CLI's
document lints, host font tables and size repairs. It never throws: it
answers `{ ok, svg, width, height, errors, warnings }`. It refuses what a
dashboard wants elsewhere:

- `dashboard-computed-number`: anything outside an allowlist (`ALLOWED` in
  `entry.ts`) of options, variants and data fields that print only the
  dataset's values. The grouped variant, the frame text, number formats,
  value-label choices, the value axis, sorting and paint are in it. Stacked
  variants, totals, shares, `valueKind`, `total100`, summary columns,
  windows, label kinds and annotations are not: they make the chart print
  numbers the data does not hold. The Dashboard type wants such numbers from
  the dataset's SQL or a `dash.calc`.
- `dashboard-one-series`: more than one series. The chart's accessible
  description prints per-category totals, which it computes.
- `dashboard-source-line`: `options.source`. The dashboard's Sources shows
  the source.

`themeFindings` lays out the spec with the theme and returns the colour
findings that the theme's overrides add to its preset, for the roles the
chart paints. This is the CLI's `judgeTheme` rule.

`draw.js` draws each entry of its `CHARTS` list inside `dash.onData`:

1. Read the dataset's rows with `dash.data(id)`. While the status is
   `loading`, the box is empty with the class `dash-skeleton`. On `error` it
   shows the type's "Failed to load" line. On other states it stays empty.
   The box keeps the `min-height` of its last drawing.
2. Build the spec with `specFromRows` (category, series and value columns).
   A dataset without a series column gets one series, named `seriesLabel`.
3. Read `--color-fg`, `--color-fg-muted`, `--color-bg`, `--color-border-line`
   and `dash.colors` as literal colours (a hidden probe element and a 1x1
   canvas resolve `var()`, `light-dark()` and alpha). Pass them as overrides
   on the preset for the scheme: `boardroom` on a light background,
   `notation-dark` on a dark one. Neither preset has colour findings of its own.
4. Call `themeFindings`. On a contrast finding or an error, draw the plain
   preset, log the codes with `console.warn`, and set
   `data-bp-theme="fallback"` on the container.
5. Lay out at the container's `clientWidth`, parse the SVG with `DOMParser`
   and insert it with `importNode`. The SVG takes `width="100%"`, keeps its
   `viewBox` and has no fixed height. Data never passes through an HTML string.
6. Draw again when the data or the width changes (`dash.onData`), when
   `data-mode` changes (the dashboard's theme switch), and when
   `prefers-color-scheme` changes (its system mode).

The container carries only `data-source="<dataset id>"`.

## Limits

- One chart type. Another type registers its definition in `entry.ts` (or in
  a file passed with `--entry`). Measured on 2026-10-25: waterfall adds about
  58,000 serialized bytes, bar about 106,000, both about 161,000.
- Rollup comes from the dev dependency tree (through tsup), not from a direct
  dev dependency.
- Annotations are not in the build. A chart with annotations answers
  `ok: false` with "the 'annotate' module is not loaded in this bundle yet".
- Conflicts with the Dashboard type:
  - No tooltip. The type asks for a tooltip on every chart that plots values.
    This build is static: no hover records and no claims.
  - The font. The SVG uses the `boardroom` Helvetica stack, and the type's
    look is `var(--font-anthropic-sans)`. A font change needs layout tables
    that match that font, so the text keeps the widths that layout measured.
- The request glue in `entry.ts` copies parts of the CLI path
  (`src/cli/spec.ts`): the render steps and the theme role walk. The engine
  has no per-type static render entry yet.
