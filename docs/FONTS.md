# Custom fonts

Layout places labels by measuring text with width tables. The bundled tables cover the preset fonts. For a brand font you are licensed to use, `boardplot fonts build` writes the tables, and the browser loads the matching font files before the first chart renders.

## Bundled tables

Geist uses its own widths (SIL Open Font License 1.1; see `NOTICE.md`). Helvetica and Arial use the widths of Liberation Sans 2.1.5 Regular and Bold (SIL Open Font License 1.1), which is metric-compatible with Arial; Helvetica shares Arial's ASCII widths. Helvetica Neue has no rows of its own, because no free Helvetica Neue font exists: a stack that names it is measured with the Liberation Sans widths, at 400 and 700. Weights 500 and 600 measure with the bold widths: real Helvetica Neue Medium draws wider than the regular widths, so the bold widths keep its text inside the measured box. Real Helvetica Neue draws a little wider than Liberation Sans, so on a machine that has it, text can run slightly past its measured box. A host that needs exact Helvetica Neue widths builds its own tables from its licensed font files with `boardplot fonts build` and passes the measurer.

Licensed brand fonts are not bundled. A host licensed for such a font builds its own tables with `boardplot fonts build` and passes the measurer, as shown below. A theme that leads with a family outside the bundled metric class and passes no tables gets the warning `family-outside-metric-class`, and its text is measured with the next family in the stack that has a table.

## Build and check

```sh
boardplot fonts build ./licensed-fonts -o boardplot-font-tables.json
boardplot fonts build ./licensed-fonts -o boardplot-font-tables.json --check
```

Without `-o` the file is `boardplot-font-tables.json` inside the font directory. `--check` rebuilds and exits 1 when the file differs. The command prints one JSON object with `outputs` and the number of faces, files and skipped files. It reads TTF, OTF, TTC, OTC, dfont, WOFF and WOFF2 files recursively and lists unreadable ones under `skipped`. The file holds family, weight, style, face index, relative path, SHA-256, vertical metrics and advances in 1/1000 em; it embeds no font binary, and the same fonts give the same bytes.

## Use the tables

Load the faces the tables describe, then pass a measurer built from the tables to the chart:

```tsx
import { createRoot } from 'react-dom/client';
import { ColumnChart } from 'boardplot/react/column';
import { createMetricTablesMeasurer, measurableFamilies, parseFontMetricTables } from 'boardplot/fonts';

await Promise.all([
  document.fonts.load('400 16px "Host Sans"'),
  document.fonts.load('700 16px "Host Sans"'),
]);
const tables = parseFontMetricTables(await (await fetch('/boardplot-font-tables.json')).json());
if (!measurableFamilies(tables).includes('Host Sans')) throw new Error('No normal Host Sans face in the tables');
const measure = createMetricTablesMeasurer(tables);
const theme = { preset: 'boardroom', overrides: { type: { family: '"Host Sans"' } } };
const data = {
  categories: [{ id: 'north', label: 'North' }, { id: 'south', label: 'South' }],
  series: [{ id: 'revenue', label: 'Revenue', values: [30, 45] }],
};
createRoot(document.getElementById('root')!).render(
  <ColumnChart data={data} theme={theme} measure={measure} size={{ width: 800, height: 450 }} />,
);
```

`boardplot/fonts` links the table parser and the measurer and no chart. The same functions stay exported from `boardplot`, but that root entry loads every chart and geo pack. Use the family recorded in your tables in place of `Host Sans`, and declare the same family and weights in `@font-face`. A direct core layout call takes the same function as `options.measure`. On the server, build the measurer from the same tables; the theme family and the loaded files stay identical on server and client. The theme check returns the warning `family-outside-metric-class` for a leading family outside Geist, Inter, Helvetica, Helvetica Neue, Arial and their metric clones. A direct call cannot see `options.measure`, so pass the families as the third argument: `validateTheme(theme, undefined, measurableFamilies(tables))`.

## CLI and MCP

`boardplot render` and `boardplot measure` take `--font-tables <file>`: the file that `boardplot fonts build` wrote. Layout then measures with those tables. When the flag is absent, the variable `BOARDPLOT_FONT_TABLES` (a path) is read. A file that is missing or is not a tables file gives an error, and nothing is drawn.

```sh
boardplot fonts build ./licensed-fonts -o boardplot-font-tables.json
boardplot render chart.json --out chart.svg --font-tables boardplot-font-tables.json
BOARDPLOT_FONT_TABLES=$PWD/boardplot-font-tables.json boardplot render chart.json --out chart.png
```

The MCP server reads `BOARDPLOT_FONT_TABLES` once at start and uses the tables for `boardplot_render` and `boardplot_measure`. It stops with an error when the file cannot be read. Every tool result, and the `initialize` answer, carries `fontTables` with the families and the number of faces, so a session can see which tables are active. A family the file does not cover is measured with the bundled tables (Geist, Helvetica, Helvetica Neue, Arial) and then by character class. The theme check does not warn about a leading family that the file covers. A PNG still needs the font installed on the machine that draws it.

## Matching and limits

- Labels use normal faces. Italic faces stay in the file but are not measured. `metricTablesFamilies` lists every family, `measurableFamilies` the ones with a normal face.
- A variable font with a `wght` axis gets one face per weight 100 to 1000, each clamped to the axis, plus the axis default. The advances at each weight come from the font's HVAR table. A variable font without HVAR keeps its default weight only and is listed under `skipped` with the reason `weights-not-tabled`.
- The measurer takes the first family in the CSS stack that has tables, then the nearest weight, the heavier one on a tie. A family the file does not hold is estimated by character class, so a stack such as `'Host Sans', 'Helvetica Neue'` loses the bundled widths that measure Helvetica Neue. Pass `{ bundledFallback: true }` as the second argument of `createMetricTablesMeasurer` to measure those families with the bundled tables first: the order is the tables you pass, then the bundled tables, then the character-class estimate. The CLI and MCP always use this order.
- Coverage is the built-in Latin ranges and listed symbols. Other glyphs use character-class estimates.
- Advances include tabular figures, as the renderer draws numbers. Pair kerning and multi-character shaping are not in the tables.

Keep licensed font files and the tables built from them in the host project.
