# Examples

Worked results for each use case in [Use cases](../use-cases.md): the input data, the chart specs, the finished file and the script that builds it. The company, Alder Outdoor, and every number are invented. The examples share one set of numbers, so the deck, the page, the dashboard and the reports agree.

The scripts call the `boardplot` CLI, which draws the same charts as the MCP tool `boardplot_render`. Every chart uses `brand-theme.json`, the `standard` preset with a navy and blue brand palette.

| Example | Use case | Result |
|---|---|---|
| [deck](deck/) | PowerPoint or Keynote deck | `quarterly-review.pptx`, an eight-slide board deck. `board-update-before.pptx` and `board-update-after.pptx`, a deck whose native charts are replaced by Boardplot charts. |
| [analysis-page](analysis-page/) | Analysis page or Claude artifact | `index.html`, a margin review with three inline SVG exhibits. |
| [react-dashboard](react-dashboard/) | React dashboard | A Vite and React trading dashboard with filters, a switchable KPI table, a shared scale and export. |
| [word-report](word-report/) | Word or PDF report | `report.docx` and `report.pdf`, a three-page monthly management report. |
| [recurring-report](recurring-report/) | Recurring report | A weekly business review: three templates, three sample exports and `render.sh`, the CLI script for a scheduled job. |

## Deck

- Each slide has a tracker, an action title and a rule in PowerPoint text, so the text stays editable. A chart fills its slot; a panel beside it holds the takeaways.
- `build.py` renders each chart with `target: "slide"` at its slot size in pt, as PNG at scale 2. The PNG records 192 dpi, so python-pptx places it at the slot size.
- The slide titles take their numbers from the render `reading`, for example the price-volume-mix effects (`pvm:effect:volume`, `pvm:effect:price`).
- The charts show what a general chart library does not draw without extra code: KPI tiles with comparisons and sparklines, a price-volume-mix bridge computed from units and revenue, CAGR labels on a stacked column, IBCS variance charts (absolute and relative), a market map (Marimekko), a P&L table with computed variances and judgement colours, and a status matrix.
- The revise case: `board-update-before.pptx` has two native PowerPoint charts. `build.py` reads the data from each chart, renders a Boardplot chart at the size of the chart's box and puts the picture in the same place. The slide text stays as it is.

## Analysis page

- `build.py` renders each exhibit once with `--return svg,reading` at 720 px, the page column. The SVG goes inline, so the page has no script and loads nothing.
- The headline, the key numbers and the findings take their numbers from the data and the reading, for example the bridge end total (`wf:total:row-7`). The build checks that the bridge adds up and stops when a render warns.
- The margin bridge uses an automatic axis break, so small steps on a large base stay readable.

## React dashboard

- `src/App.tsx` puts every chart under one `BoardplotTheme` with `target="dashboard"` and the brand theme.
- The "Compare with" switch redraws the first KPI tile and the region variance against last year or plan. The titles are computed from the same data.
- `DimSwitchChart` draws the channel KPI table. Boardplot computes the average order value and the margin as ratios of sums, the changes and their colours. The host draws the switch between "KPIs by channel" and "Channels by KPI".
- `ScaleGroup` gives the online and retail charts one value axis, so their levels compare honestly. These two cards use `LineChart` from `boardplot/react/line`: the group plans with the chart types that are registered when it renders, and `BoardplotChart` registers a type only when its chunk arrives.
- Each card has PNG and CSV export through `useExport`.
- `src/sales.ts` stands in for the sales API. Run the app with `npm install` and `npm run dev` in `react-dashboard/`. It uses the published `boardplot` package.

## Word report

- `build.py` renders each exhibit with `target: "print"`, 160 mm wide, as PNG at scale 3.125, which is 300 dpi. Word shows it at 160 mm, the text column of A4 with 25 mm margins. The charts have a fixed height of 85 mm, so two fit on a page.
- Word holds the executive summary, the section text and the next steps, so the report stays editable. The text takes its numbers from the specs and the readings, and the build checks that the EBIT bridge ends at the EBIT in the P&L table.
- The revenue chart marks October to December as forecast (`scenario: "FC"`) and draws each forecast range.
- `report.pdf` is the same document exported with LibreOffice: `soffice --headless --convert-to pdf report.docx`.

## Recurring report

- `specs/` holds the templates: no data, only the chart type, the series labels and colours, the options and the brand theme. Each template has a `name`, which names its output file. The titles describe the chart, because no one writes a new title in a scheduled run.
- `exports/` holds a sample of the three weekly warehouse exports. The table template reads plain columns (this week, last week, last year, plan) and computes the changes and their colours itself.
- `render.sh` renders the three templates into `out/<week>/` and writes `review.html`, one page to send or post. It stops with a non-zero exit when the CLI refuses the input, for example after a column was renamed (`missing-column`, exit 1).

## Rebuild an example

Install the CLI (`npm install -g boardplot`) and run the scripts from anywhere:

```sh
pip install python-pptx python-docx
python3 docs/examples/deck/build.py
python3 docs/examples/analysis-page/build.py
python3 docs/examples/word-report/build.py
docs/examples/recurring-report/render.sh
```

The Word report needs LibreOffice for its PDF. A different Boardplot version or a different set of system fonts can change the PNG bytes.

## Size

The data files are a few kB. The folder holds no build output, no `node_modules` and no lock file. A finished file such as a deck or a report is committed because it is the result a reader wants to open. The whole folder is about 3 MB.
