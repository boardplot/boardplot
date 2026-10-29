# Use cases: get a chart to other people

Each recipe starts from a chart you can draw and ends with the chart where your colleagues read it. Every recipe has the same parts: who it is for, what you get, the route, the command or component, and the pitfalls. The [manual](manual.md) explains the spec, the tools and every option.

The commands use the `boardplot` CLI from the [Quick start](../README.md#quick-start). Run them with `npx boardplot` when the package is installed in the project only. The examples draw the `status-timeline` fixture, a tracking timeline with invented data:

```sh
boardplot fixtures --id status-timeline | jq '.fixtures[0].spec | .name = "timeline"' > timeline.json
```

| Destination | Route | Format |
|---|---|---|
| [Slides and Word reports](#slides-and-word-reports) | CLI or MCP render with a `slide` or `print` target | PNG, or SVG |
| [HTML report or wiki page](#html-report-or-wiki-page) | SVG files, or one static HTML page from Node | SVG |
| [Company dashboard in React or Next.js](#company-dashboard-in-react-or-nextjs) | Per-type React components | React component |
| [Scheduled report](#scheduled-report) | CLI in a scheduled job, data from a query export | PNG |
| [Agent that writes a recurring report](#agent-that-writes-a-recurring-report) | MCP tools with `rowsFile` | PNG or SVG |

## Slides and Word reports

**For:** anyone who puts a chart into PowerPoint, Keynote, Google Slides or Word.

**You get:** an image that places at the size of its picture box, with the type sizes of a slide or a printed page.

**Route:** render with `target: "slide"` for a slide and `target: "print"` for a document. Give the size of the picture box. The target sets the type sizes for that medium. See [Sizing](manual.md#sizing).

**Command:**

```sh
boardplot render timeline.json --target slide --width 660pt --format png --out slides
boardplot render timeline.json --target print --width 160mm --format png --scale 3.125 --out report
```

The first command writes `slides/timeline.png` for a picture box 660 pt wide. The height is automatic: here 448.5 pt. The PNG has 2 pixels per layout pixel, the default `scale`, and records 192 dpi. PowerPoint, Keynote and Word read the dpi, so they place a scale-2 PNG at the chart's own size, 660 × 448.5 pt, with sharp text. The second command writes `report/timeline.png` for a 160 mm text column at 300 dpi.

Leave out `--format png` for an SVG. A `slide` or `print` SVG carries its `width` and `height` in pt, so it places at the box size too. With MCP, pass the same values to `boardplot_render`: `target`, `format`, `scale`, and the size in `options.size`, for example `{ "width": 660, "unit": "pt" }`.

**Pitfalls:**

- **Box too small.** A fixed `--height` that is too short for the chart is refused with `size-below-floor`. The error's `suggest` names the height that fits, for example "Pass height 372pt.". Run `boardplot measure timeline.json --target slide --width 660pt` to see the natural height first.
- **Fonts.** A PNG draws with the fonts installed on the machine that renders. An SVG names the theme's font stack and embeds no font, so the slide or document tool draws it with its own installed fonts. The preset themes use system fonts. For a brand font, install it where you render and see [Custom fonts](FONTS.md). Where the font is not installed, give people the PNG.
- **Background.** `--background transparent` leaves the canvas out. Label halos and hollow marks keep the theme's background colour, so place the chart on a surface of that colour. For a dark slide, use a dark preset such as `standard-dark` or `notation-dark` instead.
- **Resolution.** Raise `--scale` for print (3.125 gives 300 dpi). A higher scale does not change the placed size or the text size.
- **Wrong target.** A `report` chart printed or put on a slide keeps report type sizes. Render it again with the target of the medium.
- **Google Slides** does not insert SVG files. Use the PNG there.

## HTML report or wiki page

**For:** a team that publishes a report as HTML, or writes in Confluence, Notion or a GitHub README.

**You get:** SVG files you can attach or link, or one static HTML page with the charts inline.

**Route:** for single charts, render SVG files with the CLI and add them as images. For a page with several charts, build the page in Node with the library API. See [Static SVG without React](reference/react.md#static-svg-without-react).

**Command:**

```sh
boardplot render timeline.json --width 720 --out charts
```

This writes `charts/timeline.svg` at 720 px wide, the column width of the `report` target. In a GitHub README, link it as an image: `![Tracking timeline](charts/timeline.svg)`. Where the wiki does not take SVG images, render with `--format png` and attach the PNG.

For a static page, save this as `build-page.mjs` in a project that has the `boardplot` package installed. Each argument is a spec file:

```js
import { readFileSync, writeFileSync } from 'node:fs';
import { measureResolvedRequest, renderSvg, resolveChartRequest } from 'boardplot';

const figures = process.argv.slice(2).map((file) => {
  const request = resolveChartRequest({ ...JSON.parse(readFileSync(file, 'utf8')), size: { width: 720 } });
  const result = measureResolvedRequest(request);
  if (!result.geometry) throw new Error(`${file} was refused: ${JSON.stringify(result.refused)}`);
  return `<figure>${renderSvg(result.geometry, request.theme)}</figure>`;
});
writeFileSync('report.html', `<!doctype html><meta charset="utf-8"><title>Weekly report</title><body style="max-width:720px;margin:auto">${figures.join('\n')}</body>`);
```

```sh
node build-page.mjs timeline.json
```

`report.html` holds every chart as inline SVG. It loads no script and no file from the network.

**Pitfalls:**

- **Fonts.** The SVG names the theme's font stack and embeds no font. The reader's browser draws it with the first font of the stack it has. The preset themes use system fonts. For a brand web font, the page must load the font, or you export from React, which embeds it. See [Export fonts](manual.md#export-fonts).
- **Width.** The SVG shrinks to a narrower column, and its text shrinks with it. Render at the column width you publish at instead of shrinking a wide chart.
- **Identifiers.** Two identical charts rendered in separate calls on one page get the same SVG ids. Give them a distinct host prefix. See [SVG size and identifiers](manual.md#svg-size-and-identifiers).
- **Module type.** The package has ES module entries only. Name the script `.mjs`, or run `npm pkg set type=module` first.

## Company dashboard in React or Next.js

**For:** a team that builds an internal dashboard in React or Next.js.

**You get:** charts that size to their cards, share one theme and render on the server.

**Route:** use the React components. The [React reference](reference/react.md) has each part. Read these sections, in this order:

- [Per-type components](reference/react.md#per-type-components): import each chart type from its own entry, such as `boardplot/react/bar`, for a small bundle.
- [Container sizing](reference/react.md#container-sizing): `size="container"` lays the chart out in its card.
- [Theme provider](reference/react.md#theme-provider): `BoardplotTheme` with `target="dashboard"` sets the theme, target and locale once for every chart below it.
- [Server preparation](reference/react.md#server-preparation): `prepareChart` lays the chart out on the server, so the first paint shows the chart.
- [Rows from a query](reference/react.md#rows-from-a-query): pass query rows straight to the component.
- [Export](reference/react.md#export): give readers a PNG, SVG or CSV download of the chart they see.

**Component:** `BoardplotTheme` from `boardplot/react/theme` around per-type components such as `BarChart` from `boardplot/react/bar`, each with `size="container"`.

**Pitfalls:**

- **Fonts.** The page must load the theme's web font before the charts draw. Layout measures text with width tables. For a brand font, build them with `boardplot fonts build`. See [Custom fonts](FONTS.md).
- **Parent width.** A parent that takes its width from its content, such as a centred flex column in a Next.js page, keeps the chart at its fallback width. Give the parent its own width, for example `width: 100%`. See [Container sizing](reference/react.md#container-sizing).
- **Server and client.** Prepare with the same theme, target and provider settings the client uses, or the component throws. The data reaches the browser with the props, so remove private values before rendering.
- **Content security policy.** A strict policy needs a style nonce. See [Content security policy](reference/react.md#content-security-policy).

## Scheduled report

**For:** an analyst who sends the same charts every week by email or in a chat channel.

**You get:** fresh PNG files from the latest query export, without opening a tool.

**Route:** keep a spec as a template, without data. A scheduled job (cron, a CI schedule or a task scheduler) exports the query result to CSV or JSON and runs the CLI with `--rows`. The job then attaches the PNG to the email or posts it to the channel. See [Rows as data](manual.md#rows-as-data).

**Command:** the template `weekly-orders.json`:

```json
{
  "name": "weekly-orders",
  "type": "column",
  "data": {
    "series": [
      { "id": "online", "label": "Online shop", "colorRole": "highlight" },
      { "id": "retail", "label": "Retail" }
    ]
  },
  "options": { "variant": "stacked", "title": "Online orders keep growing", "subtitle": { "measure": "Orders per week" } }
}
```

The query export `exports/orders.csv` has one row per week and channel:

```text
week,channel,orders
W36,online,410
W36,retail,620
W37,online,455
W37,retail,598
W38,online,502
W38,retail,611
```

The job runs:

```sh
boardplot render weekly-orders.json --rows exports/orders.csv \
  --columns category=week,series=channel,value=orders \
  --format png --out "out/$(date +%F)" --quiet
```

It writes `out/<date>/weekly-orders.png` and prints `{"ok":true,"outputs":[...]}` with the file path. The rows fill the categories and the values. The template keeps the series labels and colours.

**Pitfalls:**

- **Exit code.** The CLI exits 1 when it refuses the input, for example a renamed column (`missing-column`), and 2 for an internal error. Let the job fail on a non-zero exit, so nobody gets an old chart or no chart.
- **Existing files.** A file name that is taken gets `-2`, so a job that writes to the same folder every week keeps the old files. Write to a dated folder as above, or pass `--overwrite`.
- **PNG on a server.** PNG needs `@resvg/resvg-js`, an optional dependency, or Chrome. On Linux, install one of the fonts the manual lists, or the render returns only the SVG with the warning `raster-fonts-missing`. See [Getting a chart with MCP](manual.md#getting-a-chart-with-mcp).
- **Fonts and background.** A PNG draws with the fonts installed on the machine that runs the job. Keep the default background for email and chat: a transparent PNG shows the app's own background behind it, which can be dark.
- **Locale exports.** A CSV with semicolons and decimal commas reads as a German-locale export. A number with grouping marks, such as `1.234,5`, is refused. Export plain numbers.

## Agent that writes a recurring report

**For:** a team that has an AI agent write a weekly or monthly report with charts.

**You get:** charts drawn from the query file itself, and errors the agent repairs without a person.

**Route:** the agent uses the MCP tools. It calls `boardplot_render` with the spec, the query export as `rowsFile` and the column names in `columns`. The numbers go from the file to the chart and never pass through the model. See [Rows as data](manual.md#rows-as-data).

**Tool call:**

```json
{
  "name": "boardplot_render",
  "arguments": {
    "spec": { "name": "weekly-orders", "type": "column", "data": { "series": [{ "id": "online", "label": "Online shop", "colorRole": "highlight" }, { "id": "retail", "label": "Retail" }] }, "options": { "variant": "stacked", "title": "Online orders keep growing", "subtitle": { "measure": "Orders per week" } } },
    "rowsFile": "/srv/reports/exports/orders.csv",
    "columns": { "category": "week", "series": "channel", "value": "orders" },
    "format": "png",
    "outDir": "/srv/reports/out"
  }
}
```

The answer has `ok: true`, the PNG path in `outputs` and the chart as an image block. The agent puts the file into the report for the destination, as in the recipes above.

**Errors the agent repairs:** a refused call has `ok: false` and an `errors` list. Each error has a `code`, a `path` into the spec, the `expected` values, a `suggest` sentence and often a `fix`, a JSON Patch the agent applies to the spec as it sent it. For example, `"variant": "stack"` returns `invalid-options` with the fix `replace /options/variant "stacked"`. See [Reading errors and warnings](manual.md#reading-errors-and-warnings).

**Pitfalls:**

- **Allowed folders.** The server reads `rowsFile` and writes `outDir` only in its allowed folders: the client's roots, the server's working directory, the system temp folder and the folders in `BOARDPLOT_ROWS_ROOTS`. Outside them, the call is refused with `rows-outside-roots` or `out-outside-roots`, and its `suggest` names the allowed folders. Start the server with `BOARDPLOT_ROWS_ROOTS` set to the export folder.
- **Warnings.** A chart that draws can still carry warnings, such as `label-hidden` or `values-in-note`. Have the agent read `warnings` and the `reading` before it writes the report text.
- **Target and fonts.** Pass the `target` of the destination and the size of its slot, as in [Slides and Word reports](#slides-and-word-reports). The PNG draws with the fonts installed where the MCP server runs.
