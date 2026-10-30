# Use cases: Boardplot with an AI agent

This page shows how to get finished results from an AI agent such as Claude Code or Codex with Boardplot: a slide deck, an analysis page, a React dashboard, a Word report or a weekly report. Install Boardplot once, then name it in the prompt. The agent writes the chart specs, draws the charts with the Boardplot tools and puts them into the result.

Each use case has the same parts: what you get, example prompts to copy, what the agent does, tips for better results, and the limits. Each use case also links a worked example in [examples](https://github.com/boardplot/boardplot/tree/main/docs/examples): the data, the specs, the finished file and the script that builds it, all with invented data. The [manual](manual.md) explains the spec, the tools and every option.

## Install

- **Claude Code and Codex:** install the plugin. It adds the Boardplot MCP server and the `boardplot-chart` skill. See [AI agents](../README.md#ai-agents) in the README.
- **Other MCP clients:** install the package globally and add the stdio server `boardplot-mcp`. The same README section has the config.
- **React apps:** add the package to the project. See [React](../README.md#react) in the README.

To check the install, start a new session and ask:

```text
Use Boardplot to draw a small column chart from sample data as PNG. Tell me the Boardplot version and the file path.
```

The agent calls `boardplot_render`, writes the PNG and reports the version that every Boardplot tool returns. [The plugin setup](../release/plugin/boardplot-marketplace/plugins/boardplot/SETUP.md) has the full checks and the troubleshooting.

**Tips for every use case:**

- **Give the data as a file.** Name a CSV or JSON export in the prompt, for example `data/orders.csv`. The agent passes the file to Boardplot as `rowsFile`, so the numbers go from the file to the chart and never pass through the model. See [Rows as data](manual.md#rows-as-data).
- **Name the destination.** Say "for a slide", "for a Word report" or "for a dashboard". The agent then sets the `target`, which sets the type sizes for that medium. See [Sizing](manual.md#sizing).
- **Give your brand colours.** Give the hex codes of your highlight and series colours, or a theme file. The agent passes them as a theme, for example `{ "preset": "standard", "overrides": { "color": { "highlight": "#0B5CAD" } } }`. See [the theme reference](reference/theme.md).
- **Say what each chart should show.** A title that states the finding, such as "Online orders keep growing", gives a better chart than "Orders by week".

## PowerPoint or Keynote deck

**You get:** a new deck with Boardplot charts, or your existing deck with its charts replaced by Boardplot charts.

**Example prompts:**

```text
Build a 10-slide quarterly review deck from data/q3-sales.csv. Use Boardplot for every chart.
```

```text
Revise my presentation board-update.pptx and replace all charts with Boardplot charts. Keep the slide text and layout.
```

```text
Add a revenue bridge from FY24 to FY25 to slide 4 of strategy.pptx, drawn with Boardplot, in our colours #0B5CAD and #A9C1D9.
```

**What the agent does:** Boardplot draws the chart images, and the agent's own PowerPoint tool, such as a pptx skill or a Python library, places them in the file. For each chart, the agent:

1. Reads the data from your file, or from the chart it replaces.
2. Calls `boardplot_describe` for the chart type and writes the spec.
3. Calls `boardplot_render` with `target: "slide"`, `format: "png"` and the size of the picture box, for example `options.size: { "width": 660, "height": 372, "unit": "pt" }`.
4. Places the PNG in the picture box.

The PNG has 2 pixels per layout pixel, the default `scale`, and records 192 dpi. PowerPoint, Keynote and Word read the dpi, so they place a scale-2 PNG at the chart's own size, with sharp text. Without a size, a `slide` chart is 888 × 396 pt, the content area of a 16:9 slide.

**Tips:**

- Give the size of the picture box, or say "full slide". A box that is too small for the chart is refused, and the error's `suggest` names the size that fits, for example "Pass height 372pt.".
- Ask for SVG instead of PNG when the deck stays in PowerPoint. A `slide` SVG carries its size in pt and stays sharp at any zoom.
- For a dark slide background, ask for a dark preset such as `standard-dark`. A transparent background keeps the theme's background colour in the label halos.

**Limits:**

- The charts are pictures. Colleagues cannot edit their data in PowerPoint. To change a chart, ask the agent to draw it again.
- Keynote: the agent builds a `.pptx` file, and Keynote opens it.
- Google Slides does not insert SVG files. Use PNG there.
- A PNG draws with the fonts installed on the machine that renders. For a brand font, see [Custom fonts](FONTS.md).

**Worked example:** [docs/examples/deck](https://github.com/boardplot/boardplot/tree/main/docs/examples/deck) builds an eight-slide board deck, `quarterly-review.pptx`, in a consulting layout: action titles, KPI tiles, a price-volume-mix bridge, CAGR labels, IBCS variance charts, a market map and a P&L table with computed variances. Each chart fills its slot beside editable takeaways. The revise case turns `board-update-before.pptx`, with native PowerPoint charts, into `board-update-after.pptx`: the same data drawn by Boardplot, in the same boxes, with the slide text unchanged.

![Eight slides of the board deck](https://raw.githubusercontent.com/boardplot/boardplot/main/docs/examples/deck/preview/deck-overview.png)

![A slide with native PowerPoint charts and the same slide with Boardplot charts](https://raw.githubusercontent.com/boardplot/boardplot/main/docs/examples/deck/preview/board-update-before-after.png)

## Analysis page or Claude artifact

**You get:** an analysis written as an HTML page, such as a Claude artifact or a report page, with the charts in the page.

**Example prompts:**

```text
Analyse data/churn.csv: which customer segments churn most, and since when? Write the result as an artifact and draw every chart with Boardplot.
```

```text
Write a one-page HTML report on last month's marketing spend from exports/spend.csv. Use Boardplot for the charts and our colours #0B5CAD and #A9C1D9.
```

**What the agent does:**

1. Analyses the data and decides which finding each chart shows.
2. Calls `boardplot_render` with the data file as `rowsFile` and `return: ["reading", "svg"]`. The answer carries the chart's SVG markup in `svg`.
3. Puts each SVG inline in the page. The page needs no script and loads nothing from the network to show the charts.
4. Reads the `reading` of each render, the numbers Boardplot computed (totals, differences, growth rates), and uses them in the text, so text and chart agree.

**Tips:**

- Ask the agent to state the finding in each chart title.
- Ask it to check the warnings of each render, such as `label-hidden`, before it writes the page.
- Say the column width of the page if it is not about 720 px. The agent renders at that width instead of shrinking a wider chart.

**Limits:**

- The SVG is a static image: no hover cards or filters. Those need the React components.
- The SVG names the theme's font stack and embeds no font. The preset themes use system fonts. A brand web font must be loaded by the page.

**Worked example:** [docs/examples/analysis-page](https://github.com/boardplot/boardplot/tree/main/docs/examples/analysis-page) has `index.html`, a gross margin review with a margin bridge, a category table with bars and a price-volume scatter with quadrants. Its headline, key numbers and findings take their numbers from the data and the `reading` of each render.

![Margin review page with key numbers, three exhibits and next steps](https://raw.githubusercontent.com/boardplot/boardplot/main/docs/examples/analysis-page/preview/page.png)

## React dashboard

**You get:** a new React or Next.js dashboard with Boardplot charts, or an existing dashboard with its charts moved to Boardplot.

**Example prompts:**

```text
Build the sales dashboard in Next.js from the API in src/api/sales.ts and use Boardplot for the chart work.
```

```text
Move the charts of this dashboard from our current chart library to Boardplot. Keep the data loading and the page layout as they are.
```

**What the agent does:**

1. Calls `boardplot_list` and `boardplot_describe` to choose the chart types and their options.
2. Uses the per-type components, such as `ColumnChart` from `boardplot/react/column`, with `size="container"`, so each chart lays out in its card.
3. Wraps the page in `BoardplotTheme` with `target="dashboard"` and your theme, so every chart shares one look.
4. In Next.js, prepares the charts on the server with `prepareChart`, so the first paint shows the chart.

The [React reference](reference/react.md) has each part: [per-type components](reference/react.md#per-type-components), [container sizing](reference/react.md#container-sizing), [theme provider](reference/react.md#theme-provider), [server preparation](reference/react.md#server-preparation), [rows from a query](reference/react.md#rows-from-a-query) and [export](reference/react.md#export).

**Tips:**

- Ask the agent to draw each chart once with `boardplot_render` before it writes the component. A refusal or a warning then shows up before the page is built.
- Name the chart for each card if you know it, for example "a waterfall for the margin bridge".
- When you move a dashboard, ask the agent to list each old chart with the Boardplot type it chose.

**Limits:**

- React 18 or 19. The package has ES module entries only.
- `boardplot_list` names chart forms that Boardplot does not draw. The agent keeps those charts in the old library or proposes another type.
- A parent that takes its width from its content keeps the chart at its fallback width. See [container sizing](reference/react.md#container-sizing).
- A strict content security policy needs a style nonce. See [content security policy](reference/react.md#content-security-policy).

**Worked example:** [docs/examples/react-dashboard](https://github.com/boardplot/boardplot/tree/main/docs/examples/react-dashboard) is a weekly trading dashboard in Vite and React: KPI tiles with sparklines, a channel KPI table that switches between two views, a region variance that compares with last year or plan, two weekly charts on one shared scale (`ScaleGroup`) and PNG and CSV export on each card. Run `npm install` and `npm run dev` in that folder.

![Trading dashboard with KPI tiles, a channel KPI table, a region variance chart and two weekly line charts](https://raw.githubusercontent.com/boardplot/boardplot/main/docs/examples/react-dashboard/preview/dashboard.png)

## Word or PDF report

**You get:** a Word document or PDF with print-quality charts.

**Example prompts:**

```text
Write the monthly finance report as a Word document from exports/finance.csv. Draw the charts with Boardplot for print.
```

```text
Turn this analysis into a PDF report on A4. Use Boardplot for all charts, 300 dpi.
```

**What the agent does:** Boardplot draws the chart images, and the agent's own Word or PDF tool places them in the document. For each chart, the agent calls `boardplot_render` with `target: "print"`, the text column width in mm, for example `options.size: { "width": 160, "unit": "mm" }`, `format: "png"` and `scale: 3.125` for 300 dpi. Word places the PNG at 160 mm.

**Tips:**

- Give the page format and margins, or the text column width.
- Ask for the `print` target. A `report` chart in print keeps screen type sizes.

**Limits:**

- The charts are pictures. Colleagues cannot edit their data in Word.
- A PNG draws with the fonts installed on the machine that renders.

**Worked example:** [docs/examples/word-report](https://github.com/boardplot/boardplot/tree/main/docs/examples/word-report) has a three-page monthly management report, `report.docx`, and its PDF export, `report.pdf`: an executive summary, a P&L table with computed variances, monthly revenue with a forecast range, a price-volume-mix bridge and an EBIT bridge to budget, as print charts at 160 mm and 300 dpi.

![Three pages of the monthly management report](https://raw.githubusercontent.com/boardplot/boardplot/main/docs/examples/word-report/preview/pages.png)

## Recurring report

**You get:** the same report every week or month, such as a weekly business review, with charts from the latest query export.

**Example prompts:**

```text
Every Monday, read exports/orders.csv and write the weekly business review with Boardplot charts. Reuse the chart specs in reports/specs/.
```

```text
Write a script that renders the charts in reports/specs/ from the latest exports with the Boardplot CLI, so our scheduled job can run it without an agent.
```

**What the agent does:** in the first run, the agent writes one spec per chart and saves it as a template, without data. In each later run, it calls `boardplot_render` with the template, the new export as `rowsFile` and the column names in `columns`. A refused call has `ok: false` and errors with a `path`, a `suggest` sentence and often a `fix`, a JSON Patch the agent applies to the spec. See [Reading errors and warnings](manual.md#reading-errors-and-warnings).

A scheduled job needs no agent. It runs the CLI on the same templates:

```sh
boardplot render weekly-orders.json --rows exports/orders.csv \
  --columns category=week,series=channel,value=orders \
  --format png --out "out/$(date +%F)" --quiet
```

It writes `out/<date>/weekly-orders.png`, named after the template's `name`, and prints `{"ok":true,"outputs":[...]}` with the file path. The CLI exits 1 when it refuses the input, for example a renamed column (`missing-column`), and 2 for an internal error. Let the job fail on a non-zero exit.

**Tips:**

- Keep the templates in the repository. Each run then draws the same charts with new data.
- Give every template a `name`. It names the output file. Without it each chart writes `chart.png`, and with `--overwrite` the next chart replaces it.
- Name every series with its label in the template. A series that only the rows name prints its raw id.
- Write each run to a dated folder, or pass `--overwrite`. A taken file name otherwise gets `-2`.

**Limits:**

- The MCP server reads `rowsFile` only from its allowed folders: the client's roots, its working directory, the system temp folder and the folders in `BOARDPLOT_ROWS_ROOTS`. Other paths are refused with `rows-outside-roots`.
- PNG needs `@resvg/resvg-js`, an optional dependency, or Chrome. On a Linux server, install one of the fonts the manual lists, or the render returns only the SVG with the warning `raster-fonts-missing`. See [Getting a chart with MCP](manual.md#getting-a-chart-with-mcp).
- A CSV with grouping marks in numbers, such as `1.234,5`, is refused. Export plain numbers.

**Worked example:** [docs/examples/recurring-report](https://github.com/boardplot/boardplot/tree/main/docs/examples/recurring-report) is a weekly business review. `render.sh`, the CLI script for a scheduled job, draws three templates from three warehouse exports, including a table that computes the week-on-week, year-on-year and plan changes, and writes one page to send.

![Weekly business review with revenue by week, a channel table and a region variance](https://raw.githubusercontent.com/boardplot/boardplot/main/docs/examples/recurring-report/preview/review.png)
