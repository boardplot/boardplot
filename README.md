# Boardplot

Boardplot draws consulting-grade charts and management tables for business work: slides, reports and dashboards. Its chart types include waterfalls, Mekko (Marimekko) charts and variance charts. It is free and open source under Apache-2.0.

Give an AI agent such as Claude Code or Codex your data and say what the chart should show. Boardplot runs on your computer and needs Node.js 22.12 or newer. Your agent may need a paid plan. In PowerPoint a chart is a picture, so to change it you ask the agent to draw it again.

Developers can add the same charts to a React dashboard as responsive components with tooltips.

**[Gallery](docs/gallery.md)** · [Manual](docs/manual.md) · [Chart reference](docs/reference/) · [AI agents](#ai-agents) · [React](#react) · [Changelog](CHANGELOG.md) · Apache-2.0

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/gallery/hero-dark.svg">
  <img src="docs/gallery/hero-light.svg" width="840" alt="Boardplot stacked column chart: FY25 revenue by region per quarter, AMER, EMEA and APAC, 6 to 9% above the prior year while EMEA falls from 30 to 26">
</picture>

This stacked column chart is one JSON spec drawn by `boardplot render`; the variance to the prior year above each column is computed from the data. Boardplot has <!-- BEGIN GENERATED COUNTS -->37 chart types, 83 variants and 671 example specs<!-- END GENERATED COUNTS -->; the [gallery](docs/gallery.md) shows each type with its spec.

## Who it is for

- **People who build decks and reports.** Get the waterfalls, Mekko charts and variance charts of a board deck as images for PowerPoint, Keynote or Word. Boardplot needs no licence fee or add-in. See [PowerPoint or Keynote deck](docs/use-cases.md#powerpoint-or-keynote-deck).
- **Business people who work with an AI agent.** The agent writes the chart spec, so you write no code. You need a local agent, such as Claude Code or Codex, and Node.js 22.12 or newer. The chart tools run on your computer. Claude on the web or a phone reaches them only through Claude Code Remote Control. Ask your IT team if you cannot install software. See [AI agents](#ai-agents) for the setup and [Use cases](docs/use-cases.md) for example prompts.
- **Developers who build dashboards.** The React components are responsive, with tooltips, click handlers for drill-down, zoom on time-based line and area charts, and sortable, foldable tables. See [React](#react).

## Limits

In PowerPoint a chart is a picture, so colleagues cannot edit its data there. If your team edits chart numbers on the slide, use a PowerPoint add-in. Charts do not animate their drawing or data updates.

## How it compares

Apache ECharts is a widely used general-purpose chart library for interactive web apps. Boardplot draws consulting-grade business charts for slides, reports and dashboards. The two can work side by side.

Sources checked 7 November 2026: [ECharts features](https://echarts.apache.org/en/feature.html), [waterfall charts](https://echarts.apache.org/handbook/en/how-to/chart-types/bar/waterfall/), [server rendering](https://echarts.apache.org/handbook/en/how-to/cross-platform/server/), [animation](https://echarts.apache.org/handbook/en/how-to/animation/transition/) and the [ECharts MCP server](https://github.com/apache/echarts-mcp). Boardplot is not affiliated with Apache ECharts.

| | Boardplot | Apache ECharts |
|---|---|---|
| Made for | Business charts for slides, reports and management dashboards | Interactive charts in web apps, including very large data sets |
| Where it runs | In Node.js through an AI agent, the CLI or JavaScript, and in React apps | In the browser and on a Node.js server |
| Output | SVG, PNG and React components | Canvas or SVG in the browser, SVG or PNG files in the browser or on a server |
| Software price | Free, Apache-2.0 | Free, Apache-2.0 |
| Waterfall | Built in, totals computed from the data | Drawn with stacked bars, as its handbook shows |
| Mekko | Built in | Can be drawn with a custom series |
| AI agents | MCP server and CLI included | An example MCP server from Apache ECharts, and community MCP servers |
| Interaction | Tooltips, click handlers for drill-down, zoom in time-based line and area charts, and sortable tables in React | Zoom, brush selection, legends and tooltips built in |
| Animation | No animation of chart drawing or data updates. Transitions in React tables and story steps | Built in, also for data updates |

Choose ECharts for interactive web charts, large data sets, animation or streaming. Choose Boardplot for consulting-grade business charts with built-in actual, plan and forecast notation for slides, reports and dashboards.

## Why Boardplot

- Business notation is built in: actual against plan and prior year, variances, bridges, event lanes and forecasts. Totals, shares and growth rates are computed from your data, and each render reports the numbers it derived.
- Automatic label placement: one collision solver places the labels, and a render reports every label it left out. A chart that cannot fit is refused with the size it needs.
- The same spec, settings and engine version give byte-identical SVG.
- One spec, `{ "type", "data", "options" }`, works in React, the CLI and six MCP tools. A spec error comes back as JSON with the path, the expected value and a fix, so an agent can repair the spec.

## Match your design system

- Set brand colours, series colours, type sizes and spacing through theme tokens, or start from one of ten presets. Bridge is the default.
- Style tables with the same tokens, or start from the ready table look.
- Use your own font: `boardplot fonts build` makes the width tables that layout measures with. The font files must be loaded where the chart is shown, and installed where a PNG is drawn.
- Choose the locale, the number formats and the reading target: report, dashboard, slide or print.

[The theme reference](docs/reference/theme.md) lists every token.

## Examples

Each chart links to its spec in the gallery. Companies, products, sources and numbers in the examples are invented.

<a href="docs/gallery.md#bar"><picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/gallery/readme-bar-margin-by-brand-dark.svg">
  <img src="docs/gallery/readme-bar-margin-by-brand.svg" width="840" alt="Bar chart: margin per unit by brand against the average and a 30 EUR target, with our brand highlighted">
</picture></a>

<a href="docs/gallery.md#line"><picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/gallery/readme-line-multiline-arr-endpoint-cagr-dark.svg">
  <img src="docs/gallery/readme-line-multiline-arr-endpoint-cagr.svg" width="840" alt="Line chart: cloud ARR grows 31.5% a year and overtakes licence revenue, with a growth bracket and a forecast year">
</picture></a>

<a href="docs/gallery.md#dimswitch"><picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/gallery/readme-dimswitch-statement-channels-dark.svg">
  <img src="docs/gallery/readme-dimswitch-statement-channels.svg" width="840" alt="Dimension-switch table: a contribution-margin statement per order over four weeks, with week-over-week changes and the two sales channels under the total">
</picture></a>

<a href="docs/gallery.md#table"><picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/gallery/readme-table-management-report-compact-dark.svg">
  <img src="docs/gallery/readme-table-management-report-compact.svg" width="840" alt="Management table: revenue by segment for month-to-date and closed year-to-date, with changes against last year and plan">
</picture></a>

<a href="docs/gallery.md#waterfall"><picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/gallery/readme-waterfall-build-down-dark.svg">
  <img src="docs/gallery/readme-waterfall-build-down.svg" width="840" alt="Waterfall chart: a P&amp;L build-down from revenue of 100 through COGS, wages, operating costs and D&amp;A to EBIT of 16.0, then tax to net income of 11.8">
</picture></a>

## Quick start

Boardplot needs Node.js 22.12 or newer.

```sh
npm install boardplot
cat > revenue.json <<'EOF'
{
  "name": "revenue",
  "type": "column",
  "data": {
    "categories": ["2024", "2025"],
    "series": [{ "id": "revenue", "label": "Revenue", "values": [120, 135] }]
  },
  "options": { "title": "Revenue grew 12.5 percent", "subtitle": { "measure": "Revenue" }, "unit": "$m" }
}
EOF
npx boardplot render revenue.json --out charts
```

This writes `charts/revenue.svg` and prints the result as JSON. Add `--format png` for a PNG. `npx boardplot list` shows every chart type, and `npx boardplot fixtures --type waterfall` prints complete example specs. To draw several charts in one call, which starts the CLI once, send `{ "version": 1, "charts": [...] }` with a `name` per chart; see [Several charts in one call](docs/manual.md#several-charts-in-one-call).

The package has ES module entries only (`import`, not `require`). A new `npm init` project is CommonJS, so run `npm pkg set type=module` before a server-side script imports Boardplot.

Boardplot is at 0.x: defaults and output can change between minor versions, and options can be renamed or removed. A spec with a retired setting still draws and warns: a renamed setting maps to its successor, and a removed setting is ignored. A setting that never existed is refused. [CHANGELOG.md](CHANGELOG.md) lists each change.

## AI agents

For Claude Code and Codex, install the plugin. It adds the MCP server and a chart skill. This repository is its marketplace:

```sh
claude plugin marketplace add boardplot/boardplot
claude plugin install boardplot@boardplot
```

```sh
codex plugin marketplace add boardplot/boardplot
codex plugin add boardplot@boardplot
```

The plugin installs the npm package at its own version into a Boardplot cache folder, so PNG works without a browser. For a machine without npm registry access, each release also has an offline ZIP with the runtime bundled; that route needs Chrome or Chromium for PNG. See [the plugin README](release/plugin/boardplot-marketplace/plugins/boardplot/README.md).

Any other MCP client: install the package globally once, then add the stdio server `boardplot-mcp`. It has six tools: `boardplot_list`, `boardplot_describe`, `boardplot_fixtures`, `boardplot_measure`, `boardplot_render` and `boardplot_feedback`. With a global install, npm does not run in the folder the agent works in, so that folder's npm settings cannot change which package runs. Run the same command again to update.

```sh
npm install -g boardplot
```

```json
{
  "mcpServers": {
    "boardplot": { "command": "boardplot-mcp" }
  }
}
```

Claude Code and Codex also take the server without the plugin: `claude mcp add boardplot -- boardplot-mcp` or `codex mcp add boardplot -- boardplot-mcp`.

Then ask the agent for a chart, for example "Use Boardplot to draw an EBIT bridge from this data". [llms.txt](llms.txt) indexes the manual and the chart reference for language models.

## React

React 18 or 19 is a peer dependency.

```sh
npm install boardplot react react-dom
```

```tsx
import { ColumnChart } from 'boardplot/react/column';

const data = {
  categories: [{ id: '2024', label: '2024' }, { id: '2025', label: '2025' }],
  series: [{ id: 'revenue', label: 'Revenue', values: [120, 135] }],
};

export function Revenue() {
  return <ColumnChart data={data} title="Revenue grew 12.5 percent" unit="$m" size="container" fit="content" />;
}
```

Each chart type has its own entry, such as `boardplot/react/column`. `BoardplotChart` from `boardplot/react/spec` takes a whole spec instead. The React route, in order: [Getting a chart in React](docs/manual.md#getting-a-chart-in-react), [Rows in React](docs/manual.md#rows-in-react) for query rows, [Container sizing](docs/reference/react.md#container-sizing), [Theme provider](docs/reference/react.md#theme-provider) and [Export](docs/reference/react.md#export), which ends with a complete typed PNG and SVG download.

<!-- BEGIN GENERATED CHART CATALOG -->
<!-- Generated by scripts/generate-reference.mjs from the boardplot describe, list and fixtures payloads. -->
## The catalog

37 chart types, 83 variants and 671 example specs. [fixtures.md](docs/reference/fixtures.md) lists every example spec.

| Type | Aliases | Summary |
|---|---|---|
| [`column`](docs/reference/column.md) |  | Vertical bars, grouped or stacked |
| [`bar`](docs/reference/bar.md) |  | Horizontal bars per item |
| [`line`](docs/reference/line.md) | `profile` | Lines and areas over time |
| [`dimswitch`](docs/reference/dimswitch.md) | `dim-switch-table`, `dim-switch` | KPIs by one dimension and period, from sums |
| [`table`](docs/reference/table.md) | `tbl` | Management table with totals |
| [`waterfall`](docs/reference/waterfall.md) | `bridge` | Bridge |
| [`kpi`](docs/reference/kpi.md) |  | Single-metric card |
| [`combo`](docs/reference/combo.md) |  | Columns with line or area overlays |
| [`variance`](docs/reference/variance.md) | `deviation` | Variance tier against PY, PL or FC |
| [`bullet`](docs/reference/bullet.md) |  | KPI rows with bands and target |
| [`bartable`](docs/reference/bartable.md) | `bar-table`, `table-bars` | Table rows with stacked bars, one panel per measure |
| [`pvm`](docs/reference/pvm.md) | `price-volume-mix` | Price, volume and mix bridge |
| [`pie`](docs/reference/pie.md) | `doughnut`, `donut` | Pie or doughnut of shares |
| [`status`](docs/reference/status.md) |  | Entity by period state matrix |
| [`heatmap`](docs/reference/heatmap.md) | `matrix` | Row by column matrix |
| [`gantt`](docs/reference/gantt.md) | `timeline` | Timeline with spans and events |
| [`scatter`](docs/reference/scatter.md) | `bubble` | XY/bubble |
| [`funnel`](docs/reference/funnel.md) |  | Stage funnel with conversion rates |
| [`pareto`](docs/reference/pareto.md) | `pareto-chart` | Sorted columns with cumulative curve |
| [`mekko`](docs/reference/mekko.md) | `marimekko`, `bar-mekko` | Variable-width stacked columns |
| [`sparkline`](docs/reference/sparkline.md) |  | One series as a mini line |
| [`treemap`](docs/reference/treemap.md) | `voronoi-treemap` | Part of a whole as nested areas |
| [`sankey`](docs/reference/sankey.md) |  | Flows from sources to targets in stages |
| [`grid`](docs/reference/grid.md) | `facets` | Facets and metric stacks on one category axis |
| [`slope`](docs/reference/slope.md) |  | Two-point slope lines |
| [`dot`](docs/reference/dot.md) | `cleveland`, `dumbbell`, `lollipop` | Dots, dumbbells or lollipops |
| [`cohort`](docs/reference/cohort.md) | `retention` | Retention by cohort and period |
| [`choropleth`](docs/reference/choropleth.md) |  | Region map coloured by value |
| [`butterfly`](docs/reference/butterfly.md) |  | Two mirrored bar panes |
| [`likert`](docs/reference/likert.md) | `diverging-stacked` | Diverging bars for survey scales |
| [`histogram`](docs/reference/histogram.md) | `distribution`, `frequency` | Equal-width bins of raw values |
| [`box`](docs/reference/box.md) | `boxplot`, `box-and-whisker` | Box plots of raw observations |
| [`waffle`](docs/reference/waffle.md) |  | Share of a whole as a grid of cells |
| [`pyramid`](docs/reference/pyramid.md) | `age-pyramid`, `population-pyramid` | Mirrored bands on one scale |
| [`diagram`](docs/reference/diagram.md) |  | Node and edge diagrams, including system architecture |
| [`tilemap`](docs/reference/tilemap.md) |  | Equal-size region tiles |
| [`creative`](docs/reference/creative.md) |  | Ad-creative review card (early alpha) |
<!-- END GENERATED CHART CATALOG -->

## Documentation

- [Gallery](docs/gallery.md): one drawn example of each chart type, with its spec
- [Use cases](docs/use-cases.md): prompts and steps for a slide deck, an analysis page, a React dashboard, a Word report or a weekly report built by an AI agent
- [The manual](docs/manual.md): the spec, the MCP tools, the CLI, React, sizing, errors and themes
- [Chart reference](docs/reference/): one page per chart type, plus options, themes, React and fixtures
- [llms.txt](llms.txt): an index of the manual and the reference for language models

## Development

```sh
npm ci
npm run typecheck
npm test
npm run build
```

`npm run docs:build` regenerates `docs/reference`, the gallery, `llms.txt` and the catalog table above. [CONTRIBUTING.md](CONTRIBUTING.md) and [AGENTS.md](AGENTS.md) have the rules for a pull request. [SECURITY.md](SECURITY.md) says how to report a security problem.

## License

Apache-2.0. See [LICENSE](LICENSE) and [NOTICE.md](NOTICE.md).
