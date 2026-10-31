# Boardplot manual

To have an AI agent build a slide deck, an analysis page, a React dashboard or a report with Boardplot charts, start with [Use cases](use-cases.md).

## What Boardplot is

Boardplot draws consulting-grade charts: 37 chart types, tables and maps among them, with every label placed by one collision solver. The output is deterministic SVG or a React component, so the same spec gives the same drawing byte for byte. Totals, differences, shares and growth rates are computed from the data, and each render reports the numbers the engine derived.

## The spec

Every chart is one JSON object, the spec.

```json
{
  "name": "revenue-mix",
  "type": "column",
  "data": {
    "categories": ["2021", "2022", "2023", "2024", "2025"],
    "series": [
      { "id": "subscriptions", "label": "Subscriptions", "values": [62, 74, 88, 103, 121] },
      { "id": "services", "label": "Services", "values": [38, 41, 43, 44, 46] }
    ]
  },
  "annotations": [{ "kind": "cagr" }],
  "options": {
    "variant": "stacked",
    "title": "Subscriptions carry the growth",
    "subtitle": { "measure": "Revenue by line" },
    "unit": "$m"
  },
  "theme": "boardroom"
}
```

- `name` is optional: the output file name and the chart's identity, default `chart`. It takes letters, digits, `.`, `_` and `-`.
- `type` names the chart type. `boardplot_list` returns all of them with their aliases.
- `data` has the shape of that type. `boardplot_describe` lists its fields.
- `options` is optional. It holds the title, subtitle, unit, source, axes and labels, plus the options of the type. `options.target` names the medium the chart is read in and `options.size` its slot; see [Sizing](#sizing). The subtitle prints the unit after its measure ("Revenue in $m"); a unit that neither the subtitle, an axis title nor a value label prints gets the warning `unit-not-shown`.
- `annotations` is optional. An annotation attaches a callout, note, difference arrow, CAGR arrow or value line to a data id, and the engine computes the number it prints. A `cagr` draws a bracket over the marks. With `shape: "arrow"` it draws one straight arrow with the rate in an oval on it, and falls back to the bracket with the warning `cagr-arrow-no-room` where no straight line clears the chart or the span is too short for the oval.
- `theme` is optional. It takes a preset name or a theme object; see [Themes](#themes).

A field the type does not list is an error. `boardplot_render`, `boardplot_measure`, the CLI and the React component `BoardplotChart` all take this spec.

## Choosing a chart

The table maps a frequent business message to a Boardplot type, the most common first. Get the fixture with `boardplot_fixtures` and the type and id, then change the data. The table does not decide what the exhibit should show; that stays the author's choice.

| Message | Type and key options | Fixture | Common pitfall |
|---|---|---|---|
| Actual vs plan per period | `grid`, `sharedAxis: "category"`: a `column` panel with AC and the PL series as `role: "reference"`, a `variance` panel with `variant: "absolute"` and `variance: { vs: "pl" }` | `weekly-actual-vs-plan` | AC and PL as grouped columns: the reader must find each gap by eye. |
| Actual vs prior year | `column`, `variant: "stacked"`, one PY series with `role: "reference"`; for ΔPY tiers, `grid` with `variance` panels | `integrated-stacked-variance`, `three-tier` | A PY series without `role: "reference"` draws as one more data series. |
| Ranking | `bar`, `sort: { categories: "desc" }` | `margin-by-brand` | Columns with long category names; a bar keeps the names on one line. |
| Trend against plan | `line`, the actual series and a plan series with `scenario: "PL"`, `gapFill` between them | `option-cost-gap` | `gapFill` tones follow the order in `between`: with the cost named first, above plan is bad, so set `positiveTone: "bad"`. |
| KPIs and a margin statement by channel over weeks | `dimswitch`, `dimension.sums: true`, measures with a `value` formula over the sums, `partOf` and `result` for the statement lines | `statement-channels` | A rate in the sums: the Total adds it up across the channels. Put counts and amounts in the sums, and let the formula divide. |
| Revenue report by segment against prior year and plan | `table`, `variant: "hierarchy"`, one `columnGroups` block per period, `computed` YoY and vs-plan columns | `management-report-compact` | A typed percentage column: parent rows add up the children's percentages. A `computed` column derives each row's own ratio. |
| Bridge: what moved the number | `waterfall`, `items[].type` `"total"` at both ends, deltas between; `pvm` for price, volume and mix | `ebit-bridge` | A typed end total: Boardplot sums the deltas, and a total value that differs warns `derived-mismatch`. |
| Mix or share | `column`, `variant: "stacked100"` | `stacked100-energy-mix` | A pie with more than six slices warns `pie-too-many-slices`, and pies do not compare periods. |
| KPI overview | `kpi` with `data.delta: { vs, scenario }` per card; for many metrics, `table` with `variant: "steering"` | `arr-card`, `steering-monthly` | A long row of cards where one table compares the metrics. |
| Status review | `status`, `options.states` with a `tone` each and a `pattern` on the at-risk state | `programme-rollout-rag` | Tone alone: a state without a pattern is lost in a grayscale print. |
| Distribution | `histogram` for one group, `box` for several | `order-value-distribution`, `deal-size-by-region` | A column of averages hides the spread and the skew. |
| Correlation | `scatter`, `trend: true` | `price-volume-trend` | The trend line shows association, not cause; r² comes back in the render's reading, not on the chart. |

## Bartable totals

The `bartable` Total adds the rows given; if you cut rows, send a residual row with the rest or rename the Total through `options.strings.total`.

## Getting a chart with MCP

The MCP server `boardplot` has six tools. Each answers with JSON; a rejected call carries `ok: false` and an `errors` list. Every answer carries `engineRev` and `version`, the build exactly as `boardplot --version` prints it, so a host can tell a stale server from the CLI beside it.

| Tool | Call it to | What comes back |
|---|---|---|
| `boardplot_list` | see which chart types exist | each type, the most common first, with summary, use cases, chart IDs (`type.variant`), aliases and size floor; the shared options; the theme presets; chart forms Boardplot does not draw |
| `boardplot_describe` | write a spec for one type | the data fields, the options with values and defaults, a minimal spec, the size floor, the annotation kinds and fixture ids |
| `boardplot_render` | draw a spec | a reading of the drawing (derived numbers, labels placed and dropped), warnings, the SVG on request, a PNG with `format: "png"` |
| `boardplot_measure` | fit a chart to a known width | the minimum, natural and comfortable size, the number of title lines, a refusal with the pixels it needs |
| `boardplot_fixtures` | start from a complete example | runnable specs with real-looking data, by `type` or `id` |
| `boardplot_feedback` | report a Boardplot problem | a draft report and `issueUrl`, a prefilled GitHub issue the user opens and submits; it sends nothing |

A render refusal keeps its size estimate in `expected.minimum` and `fix`. Library `canDraw()` returns it as `minimum`. Measurement verifies a size that draws without a size warning. CLI and MCP measurement return that size as `required`. A data warning such as `dual-axis`, or a proportion lint such as `height-off-ladder` or `aspect-cap`, does not reject that size. The height search is bounded. If no tested size draws within the bound, `suggest` names the bound and asks for less content or changed settings.

A worked example, an EBIT bridge. Ask for the waterfall contract:

```json
{ "name": "boardplot_describe", "arguments": { "type": "waterfall" } }
```

The answer has a minimal spec and one line per field, the first clause of its description; a line that ends in … leaves text out, and `path` returns all of it. `"detail": "full"` (MCP), or `boardplot describe <type> --full` (CLI), returns the whole description of each field and every fixture id. `"path": "valueAxis.break"` returns that one field and the fields below it in full, or, when the type refuses the field, the reason under `refused`; a leading `data.` or `options.` picks the half, as in `data.items[].value`. `"schema": "data"` or `"options"` returns the JSON Schema of that half, for a generator that fills a schema. An excerpt of the plain answer:

```json
{
  "ok": true,
  "type": "waterfall",
  "data": {
    "items": "array, required. Ordered bridge items…",
    "items[].id": "string, required. Unique bridge-item identity used by connectors and annotations.",
    "items[].label": "string. Displayed bridge-item name…",
    "items[].type": "\"delta\" | \"subtotal\" | \"total\". Delta contribution by default…",
    "items[].value": "cell. Signed delta contribution, or an optional check value for a subtotal or total…"
  },
  "sizing": { "minWidth": 280, "minHeight": 270, "fit": "fill" }
}
```

Then draw it:

```json
{
  "name": "boardplot_render",
  "arguments": {
    "format": "png",
    "spec": {
      "type": "waterfall",
      "data": {
        "items": [
          { "id": "fy24", "label": "EBIT FY24", "type": "total", "value": 120 },
          { "id": "price", "label": "Price", "value": 18 },
          { "id": "volume", "label": "Volume", "value": 9 },
          { "id": "cost", "label": "Input cost", "value": -14 },
          { "id": "fy25", "label": "EBIT FY25", "type": "total" }
        ]
      },
      "options": { "title": "Price gains outweigh higher input cost", "subtitle": { "measure": "EBIT" }, "unit": "$m", "source": "Finance, FY25 close" }
    }
  }
}
```

The result holds the chart as an image content block and this JSON, shown here in part:

```json
{
  "ok": true,
  "size": { "width": 720, "height": 482 },
  "reading": {
    "type": "waterfall",
    "labelsDropped": 0,
    "derived": [{ "claimId": "wf:total:fy25", "operation": "waterfall total", "displayed": "133", "value": 133 }]
  }
}
```

Each derived reading has `visible: true` when it has displayed text. A calculation that is not printed has `visible: false` and `displayed: "Not displayed"`. `reading.omissions` lists each hidden label and its destination. This includes axis labels removed before placement and values moved straight to a note. A label without a replacement label or note has destination `reading.omissions`, which keeps its text. One `label-hidden` warning reports the missing labels for the chart. Redundant labels, whose information is printed elsewhere, do not cause this warning.

`reading.counts` lists structural counts and their exact phrases in the accessible description. A host can match these phrases without parsing prose. See [Chart reading counts](reference/reading.md).

The last item has no value, so the engine computed the FY25 total of 133. A total that carries a value is checked against the sum; the computed value is drawn and the render warns `derived-mismatch`.

`boardplot_render` takes `spec` and optionally `format` (`svg` or `png`), `target` (see [Sizing](#sizing)), `width` and `height` in px, `scale` (PNG pixels per layout pixel, default 2), `background` (`theme` by default; `transparent` leaves the canvas out, while halos and hollow marks keep the theme background colour, so place the chart on a surface of that colour), `return` (`["reading"]` by default; add `"svg"` for the markup) and `outDir`, an absolute directory to write the files to. PNG uses `@resvg/resvg-js`, an optional dependency, when it is installed, and otherwise Chrome or Chromium, found on the usual paths or through `BOARDPLOT_CHROME_PATH`. With neither, the render returns the SVG and the warning `no-rasterizer`. Chrome's exit code does not decide: on a busy machine Chrome writes the PNG and then exits 2, so a PNG that decodes at the requested size counts as drawn. Without one, Boardplot runs Chrome once more and then fails with `png-export-failed` (exit 2), whose message names the cause: a browser that would not start, the 60 s timeout, a crash, or Chrome's exit code with its last line of output. On Linux, resvg draws with the first family of the theme stack that fontconfig lists, else Liberation Sans, Arimo, Nimbus Sans, DejaVu Sans or Noto Sans; with none of them installed Chrome draws the PNG, and without Chrome the render returns the SVG and the warning `raster-fonts-missing`. A chart with characters the theme font has no width for, such as emoji or CJK, is drawn by Chrome when Chrome is installed, because resvg draws them as boxes and loses the whole label with them. On macOS and Windows, which ship those fonts, Chrome clears the warning; on other systems the warning `png-glyph-coverage` stays, because Chrome draws boxes when no installed font covers a character. Without Chrome the render keeps the resvg PNG and warns `png-glyph-coverage`, naming the labels that can be lost. A PNG above 100 million pixels (width x height x `scale` squared) is refused with `png-too-large` (exit 1), because the rasterizer would run out of memory; draw the SVG, lower `scale` or shrink the canvas. `boardplot_list` reports the limit as `limits.pngPixelsMax`. A PNG records 96 dpi times `scale`. [PowerPoint or Keynote deck](use-cases.md#powerpoint-or-keynote-deck) says how slide and document tools place it.

### Rows as data

A query result does not have to be copied into `data`. `boardplot_render` and `boardplot_measure` take a flat table, one row per category and series pair, as `rows` inline or as `rowsFile`, the absolute path of a local `.json` file (an array of row objects) or `.csv` file (a header row) of at most 2 MB. A CSV whose header line holds more semicolons than commas is read as semicolon-separated, as German-locale exports are, and its value column reads a decimal comma as a decimal (0,505 is 0.505); a number with grouping marks such as 1.234,5 is refused with its row, and so is 1.234, which could be 1234 or 1.234. A leading byte order mark is skipped. Read from a file, the numbers never pass through the model. `columns` names the source column for each role: `category`, `series` and `value` are required, `categoryLabel`, `seriesLabel`, `unit`, `date` and `state` (`na`, `nm` or `suppressed` for a cell whose value is null) are optional. Each role names its own column, with one exception: `date` may name the category column, so one SQL date column gives both the category ids and their dates. A category without a `categoryLabel` gets no label, so an ISO date id such as `2026-01-01` prints as a short date ('Jan', with the year on its own row) on the axis and in the hover card. `valueKind` says how the value column is written: `number` (the default), `percent` (50.5 is 50.5 %) or `fraction` (0.505 is 50.5 %).

The MCP server reads a `rowsFile` only from an allowed folder. The allowed folders are the roots the client sends (the server asks for them when the client declares the roots capability), the server's working directory (unless it is the filesystem root), the system temp folder, and every folder in the environment variable `BOARDPLOT_ROWS_ROOTS` (several separated by `:`, on Windows by `;`). The check runs on the resolved path, so a symlink that points outside is refused too. A file outside these folders is refused with `rows-outside-roots`, and nothing is read. `outDir` follows the same rule: a path outside these folders, also through a symlinked folder, is refused with `out-outside-roots`, and nothing is written. The CLI's `--rows` and `--out` take any path you name.

```json
{
  "name": "boardplot_render",
  "arguments": {
    "spec": { "type": "column", "data": { "series": [{ "id": "Online", "label": "Online shop", "colorRole": "highlight" }] }, "options": { "title": "Online holds half of North" } },
    "rows": [
      { "region": "North", "channel": "Online", "share": 0.5 },
      { "region": "North", "channel": "Retail", "share": 0.5 },
      { "region": "South", "channel": "Online", "share": 0.38 },
      { "region": "South", "channel": "Retail", "share": 0.62 }
    ],
    "columns": { "category": "region", "series": "channel", "value": "share", "valueKind": "fraction" }
  }
}
```

The rows here are inline; `"rowsFile": "/data/exports/channel-share.csv"` in their place reads the same columns from a file. An absent category/series pair becomes `null`, which means unknown. A composition with a missing component withholds its share labels. When the source proves that a pair has no value, supply an explicit zero row. For example, `{ "category": "A", "series": "S1", "value": 12 }` and `{ "category": "A", "series": "S2", "value": 0 }` form a complete composition under `columns: { category: "category", series: "series", value: "value" }`. Keep unknown pairs as null.

A repeated CSV header warns `rows-header-repeated`: the first column keeps the name, and the next reads as `name.1`, `name.2` and so on.

For category charts, the rows become the spec's `data.categories` and `data.series`, in the order they first appear. A category or series the spec already names keeps its other fields, such as a label or a `colorRole`, so a spec works as a template the rows refill; a column the map names wins. Rows fill one bare spec of a type whose data is categories and series (bar, bartable, butterfly, column, combo, dot, funnel, heatmap, line, mekko, pie, slope, variance). A `bartable` takes the categories as its table rows and the series as its bar segments, and the value column fills one panel. The spec's first panel is the template for that panel: the panel keeps its id, label, unit, weight, format and aggregate. Without a template, the panel's id is the value column's name. The rows drop the template's `ends`, any other panel and the number `columns`, because these lists hold one value per authored row. Percent values fill the panel as plain numbers, and the panel unit becomes `%` when neither the rows nor the template name a unit. The panel adds its segments, so rows with two different units, percent values beside plain numbers, or a value cell with more than its number (such as a `format`) are refused at their row. A pair that appears twice, a text value, a state beside a value and a named column no row has are refused with the row that holds them, and rows with no data row (a CSV with only its header, an empty array) are refused as `rows-empty`. The reading gains `data`: the row count, the `sha256` of the file bytes (of the canonical JSON for inline rows), the source, the columns nothing read and the cells a state suppressed. `boardplot_measure` returns the same `data`.

A number in a category, series or other text column reads as its text, as a CSV cell does, so `"year": 2024` names the series `2024`.

### Waterfall and scatter rows

Waterfall (alias `bridge`) takes one row per item. Use `--columns label=item,value=amount,type=kind`, or the MCP object `columns: { "label": "item", "value": "amount", "type": "kind" }`. `label` and `value` are required. The optional `type` column uses the waterfall names `delta`, `subtotal`, and `total`; an absent or blank type means `delta`. Row order is item order. A delta adds its value. An opening total sets the starting value. Later subtotals and totals use the running sum; their supplied value is a check value. A mismatch warns `derived-mismatch` and draws the running sum. Use null or a blank value for a total with no check value.

Scatter (alias `bubble`) takes one row per point. Use `--columns x=effort,y=output,size=volume,label=item,group=team`, or the same roles in the MCP `columns` object. Only `x` and `y` are required. `size` supplies bubble magnitude. `label` supplies the point name. `group` fills `points[].group` and creates `data.groups` in first-appearance order. A matching group in the spec keeps its label and style. With no group column, the spec's groups stay as authored. With no label column, point labels use their generated ids.

Sankey takes one row per link, the shape of a `GROUP BY source, target` result. Use `--columns source=from_page,target=to_page,value=visits`, or the same roles in the MCP `columns` object. `source`, `target` and `value` are required. For flows between segments month to month, add `sourceStage` and `targetStage` (for example the month and the next month): then a node is the pair of stage and id, so the same segment in two months is two nodes. A numeric id is read as text. Rows with the same ends add up.

Both mappings generate ids `row-1`, `row-2`, and so on. Labels can repeat. Rows replace `data.items` or `data.points`; other authored data stays in the spec. Named columns must exist in the source. Invalid cells report their source row and column. The reading and measure report the row count, SHA-256 and ignored columns, as for category rows. `valueKind` applies to the waterfall value or both scatter coordinates; bubble size stays a number. For different coordinate kinds, pass numeric cells in JSON rows and set each axis format in the spec. These mappings work with CLI render/measure and MCP `boardplot_render`/`boardplot_measure`, for inline rows and JSON or CSV files.

### Table rows

Table (alias `tbl`) takes one row per table row. The spec's `data.columns` declares the columns; the engine infers no column from the rows. Each `value`, `text`, `status` or `date` column reads its cells from the source field with the same name as the column id. The `rowLabel` column shows the row label, which comes from the `label` role. `computed` and `encoding` columns keep their definitions and read no source field. Use `--columns label=region,id=code`, or the MCP object `columns: { "label": "region", "id": "code" }`. Both roles are optional; without `id`, the rows get the ids `row-1`, `row-2`, and so on. A table takes no `valueKind` other than `number`: write a percent column in points and give it a percent format.

Numbers, text, null and table cell objects pass through as cells, and a field that a row lacks becomes null. Only a `value` column reads CSV text as a number, with the decimal comma of a semicolon CSV. A column whose field no row has, text that a `value` column cannot read as a number, a boolean or other invalid cell, and an empty or repeated row id are refused with the source row and field; a table warning about a source cell names that row and field too. Rows keep their source order and columns keep the spec's order. A spec row with the same id keeps its authored fields, such as `role`, `parentId`, `calc` or `format`, so totals, hierarchy and formulas stay in the spec; spec rows that no source row names are not drawn, and a drawn row whose `parentId` or `calc` names such a row is refused at that spec field. The reading reports the source fields that no column and no role reads in `ignoredColumns`.

### Histogram and box rows

Histogram (aliases `distribution`, `frequency`) takes one row per observation: `--columns value=days`, or `columns: { "value": "days" }`. Box (aliases `boxplot`, `box-and-whisker`) takes one row per observation and groups the rows by the `category` column: `--columns category=team,value=days`. `category` and `value` are required; the optional `categoryLabel` and `date` give each group its label and observation date, and `date` may name the category column. Groups keep the order in which they first appear. A group the spec already names keeps its other fields. A group with two different labels or two different dates, a label or date that is not text, and a repeated group id in the spec are refused.

Every row is an observation, so nothing is dropped without a word. A null, blank, non-numeric or non-finite observation is refused with `missing-value` or `invalid-value` and its source row and field; remove or fix those rows before the call. A histogram still needs at least four observations. These shapes take no `valueKind` other than `number`; set the number format in the spec options.

### Map rows and classes

Choropleth and tilemap accept the same `rows` and `rowsFile` inputs. Set `columns: { "category": "area", "value": "score" }`. Each row supplies one region. Keep `data.pack` and any `data.overlays` in the spec. Maps accept `state` and `valueKind`; region names come from the pack, so other column roles are refused. Duplicate regions and invalid values are refused. The reading includes the row count and SHA-256, as for category charts.

Maps use a continuous ramp unless `classes` or `steps` is set. `classes` breaks on round numbers: steps of 1, 2, 2.5 or 5 times a power of ten, on a grid through 0 or through the diverging midpoint, so no class straddles the midpoint. One class holds at most 40 % of the regions when a round step allows it. `steps: [15, 25, 35, 45]` reuses the cohort chart's four ascending thresholds and defines five classes. A value on a threshold enters the higher class. The first and last classes are open-ended. `classes`, if also set, must be 5. The format must print the thresholds exactly. A choropleth key prints one range under each class, for example `<20`, `20–<40` and `≥80`. The key has no title unless you set `keyTitle`.

A choropleth writes each region's code on its shape. A region too small for its code gets the code beside the shape on a short leader. `valueTable` adds a table of every region with its swatch, code and value; the top regions are bold. `'auto'` (default) shows the table for at most 20 regions: beside the map when there is room, else below it when the frame can grow, else not at all. `'side'` and `'below'` set the place, and `false` turns the table off. With the table on, the map prints codes only.

A listed region with `value: null` has a hatch and the key says “Value missing”. An unlisted region has plain background and the key says “Not in data”. This distinction is automatic. A status glyph reserves space before labels are placed. Tile glyphs stay inside one tile. A glyph that cannot fit is omitted with a warning. Labels that move to the tile note also produce a warning.

### Fraction values in chart data

Set `data.valueKind: "fraction"` when all numeric series values are fractions.
Set `data.series[].valueKind: "fraction"` for one series, such as a combo line beside count columns.
The engine converts `0.153` to `{ "pct": 15.3 }` once at input. Labels, axes, hover records, accessible text and calculations use percent units.
A percent format sets the printed style; it does not multiply values by 100. `percent-scale-suspect` warns when an undeclared series has values within ±1 and a percent format, percent cells or percent labels on a chart that shows the authored values. Composition charts derive shares from weights and do not need this warning. Grid panels get the same checks as separate charts. Numeric values without a percent claim keep their numeric units.
Numeric cells and their ranges convert. Null stays missing. Explicit `{ "pct": 15.3 }` cells already use percent units and do not convert again.
Formats, targets and axis bounds still use percent units. A numeric `valueLine` also uses percent units by default. Set its own `valueKind: "fraction"` to multiply its value and tolerance by 100. This setting is independent of `data.valueKind`. A value line within ±1 far below fraction data warns `percent-scale-suspect` with this fix. `"0.0%"` and `"1.0%"` both mean one decimal.
This field applies to bar, column, line, combo, dot, butterfly, slope, variance, heatmap, mekko, pie and funnel data. Sparkline uses `data.valueKind` for its single series.
Other data schemas refuse the field. For a combo rate, keep its separate percent axis and the required `secondaryAxis.acknowledge` setting.

### Small values

Without an authored format, each table column and each chart series gets one precision from its largest value. Below 1, that value keeps two significant digits: 0.0341 gives three decimals, so 0.0123 and 0.0051 print 0.012 and 0.005. No automatic format prints more than four decimals. A nonzero value below the last shown digit prints its bound: `<0.001` at three decimals, `>−0.001` below zero, `<1` for whole numbers. A signed change label keeps its sign: `<+0.001` and `>−0.001`, so it reads as a change like its neighbours. Below 0.0001 it prints in scientific form, `1.2 × 10⁻⁹`. A true zero prints in the column's format, such as `0.0`. Set `options.smallValues: "zero"` for spreadsheet style (`0.000`) or `"scientific"` for a power of ten. `"p-value"` prints every value from 0 to 1 as APA 7 writes a p-value: three decimals without the leading zero (`.042`) and `<.001` below. An authored format prints as authored.

A `k`, `M` or `B` after the digits of a format example scales the value: `"$1.2M"` prints 2,456,000 as `$2.5M`, and `"1.2k"` prints 1,250 as `1.3k`.

An example with one dot before three digits, such as `"1.234"`, can be a thousands group or three decimals. The chart's numbers decide. Where every number is below 1000 and one has a fraction, it means three decimals: 0.512 prints `0.512`. Otherwise it is a group: 1,200 prints `1,200`, and where a small number loses its fraction beside large ones, the warning `format-reads-as-group` names it. `"0.000"` always means three decimals, and `"1,234"` always means a group.

### Shares that add up

An authored `options.format` fixes its decimals, including trailing zeroes. Series formats and cell formats override it. A mekko column total takes more decimals only where the format would print a nonzero total as 0. Without an authored format, precision follows the data. On a percent mekko, a percent example formats shares; absolute column totals keep a number format. Their unit comes from `series[].unit` when every data series declares the same unit. `options.unit` names the shares and never labels those absolute totals.

Rounded one by one, the shares of a whole can print a sum such as 100.6 %. `options.rounding` applies on bar, bartable, column, combo, line, mekko and pie. Bar, column and combo stacks, a bartable cascade and a stacked100 area default to `"sum-consistent"`. Mekko and pie default to `"nearest"`, and a pie warns `share-rounding-drift` when its printed shares miss 100 %. Under `"sum-consistent"` a chart prints every share of a whole at the finest precision one of them needs and moves the fewest shares one step, those that rounding moved furthest, until the printed shares add up to 100 %; no share moves a whole step from its value. The reading lists each moved share under `rounding` with its value, what it prints on its own and what it prints now. A bar, bartable, column, combo or line chart with a moved share also adds one method note to its notes list, which prints under the chart only where `notes.show` lists `"method"`. On a column or bar stack with `sharesOfOneWhole`, the same note says when the authored parts miss 100 and each share is taken of the stack total. The allocation uses the largest-remainder rule. For equal remainders, when the sum must go up, round up the smaller share first; when the sum must go down, take the step from the larger share first. Equal-size ties use the first input index. Use `options.format: "1.0%"` for one decimal when whole-percent adjustments are too coarse. Other types refuse the option.

### Missing stack parts

In a stacked column, bar or combo, `null` means a value that is unknown. A stack with a `null` part prints the sum of its known parts as a plain total. The notes list names the missing parts ("Totals add the known parts only: Q1 without B"), and the chart gives one `incomplete-composition` warning. With `notes: { show: ["disclosure"] }` the total also prints "(partial)" under its value, and the note prints under the chart. When a component is known to be zero in a category, because it does not apply there, give it `0`. Then the total is complete. Keep `null` for values that are really missing.

### SVG size and identifiers

The SVG carries its size as `width` and `height` and shrinks to a narrower container. A label halo is a second, stroked copy of the text under it. It works in importers that ignore `paint-order`, such as LibreOffice.

SVG `id` attributes and their references use a hash of the drawing, locale and resolved document theme. `data-id` is a stable part name. It is not a DOM id and does not need page-wide uniqueness. Light and dark renders have distinct ids. Identical charts in one document get a suffix for each copy. Use a distinct host prefix for identical charts rendered in separate calls.

### Gantt and grid formats

Gantt and ordinary grid compositions have no numeric value labels of their own. Metric stacks set mark precision with panel `decimals` and `divisor`. A chart-level `format` is accepted, ignored and warns. Set each numeric grid panel's `options.format` instead. Gantt uses calendar date options.

### Metric stack

Use `grid` with `options.stack: {}` for two to five measures over the same cohorts or periods. Panels follow the data array from top to bottom. Each panel starts at zero on its own scale. One category axis and an optional period row sit below all panels. See [the metric stack section in the grid reference](reference/grid.md#metric-stack).

Store counts once in `data.measures`. Each panel names either a sum or a numerator and denominator. `readout: "change"` compares `data.windows.base` and `compare`: whole-percent change of average counts per category, or percentage-point change of weighted rates rounded to one decimal. `readout: { "base": "measure-id" }` gives a weighted mature step rate and the remaining-per-100 chain. The engine computes these figures from the same counts as the marks. `reading.metricStack.readouts[]` gives their inputs and category windows. Each readout has a `method` and `grain`. Count changes use `average-change`; rate changes use `rounded-rate-change`; step rates use `weighted-rate`. Grain is day, week, month, quarter, year or category. It comes from `data.windows.grain` or the category ids; unrecognised ids use category.

Mark a running category `partial: true`. Declare unavailable outcome panels in `data.states.partial.panels`. Declare the maturing range and its affected panels in `data.states.maturing`. The grid draws one continuous band across those panels. Provisional bars use light fills and dashed outlines. Provisional lines use grey dashes and hollow points. Partial points never connect. Dashes denote projected or provisional data. One panel may set `emphasis: true`.

The engine owns label space, one panel gap and one shared readout gutter. Use `stack.heights` for plot heights in layout pixels, or `rows` for proportional heights. Too-small authored gaps, gutters or heights are refused. A width-only size grows to the content height. Slide text can need more height than report text. The example fixtures are `metric-stack-volume` and `metric-stack-steps`. Existing grids keep their current layout.

## Getting a chart with the CLI

The CLI `boardplot` has the same verbs and prints the same JSON, one object per command on stdout. `-` reads the spec from stdin.

```sh
boardplot describe waterfall
boardplot render - <<'EOF'
{
  "type": "waterfall",
  "data": {
    "items": [
      { "id": "fy24", "label": "EBIT FY24", "type": "total", "value": 120 },
      { "id": "price", "label": "Price", "value": 18 },
      { "id": "volume", "label": "Volume", "value": 9 },
      { "id": "cost", "label": "Input cost", "value": -14 },
      { "id": "fy25", "label": "EBIT FY25", "type": "total" }
    ]
  },
  "options": { "title": "Price gains outweigh higher input cost", "subtitle": { "measure": "EBIT" }, "unit": "$m" }
}
EOF
```

The second command prints the same JSON as `boardplot_render`, here in part:

```json
{ "ok": true, "errors": [], "size": { "width": 720, "height": 454 }, "warnings": [] }
```

The exit code is 0 when the call succeeded, 1 when the input was rejected and 2 for an internal error. The other commands: `boardplot list`, `boardplot describe waterfall --full`, `boardplot describe mekko --path valueAxis.break`, `boardplot describe column --schema options`, `boardplot render spec.json --rows sales.csv --columns category=month,series=segment,value=revenue` (a relative rows path resolves against the working directory), `boardplot fixtures --type waterfall`, `boardplot measure spec.json --width 400`, `boardplot render spec.json --format png --out ./charts` (a PNG goes to a file), `boardplot fonts build <font-dir>`, `boardplot telemetry status`, `boardplot feedback --category bug --summary "..."` and `boardplot --version`.

A file in `--out` takes the chart's name, `chart` when the spec has none; a taken name gets `-2`, so a render keeps existing files by default, and the warning `out-name-taken` names the requested and the written path. `--overwrite` replaces existing output files at the requested paths. The MCP tool uses `overwrite: true` for the same result. Duplicate chart names within one call still get separate files. `--quiet` prints only `ok` and `outputs` when the render succeeds, which keeps a shell loop over many variants readable; a refused spec still prints its errors. An `--out` that cannot be a folder, such as an existing file or a folder without write permission, is refused with `out-unwritable` and exit 1.

### Problem reports and usage counts

When Boardplot itself fails, refuses wrongly or draws something misleading, offer the user a problem report: `boardplot_feedback`, or `boardplot feedback` on the CLI. Write the summary without client names, numbers, labels or paths, show the user the report, and let the user submit `issueUrl` on GitHub. Send nothing without the user's yes to that exact text. Usage counts are off until the user runs `boardplot telemetry on`; never run it for the user unasked. [Telemetry and feedback](TELEMETRY.md) lists every field.

## Getting a chart in React

`BoardplotChart` takes the same spec.

```tsx
import { BoardplotChart } from 'boardplot/react/spec';

const spec = {
  name: 'revenue-mix',
  type: 'column',
  data: { categories: ['2021', '2022', '2023', '2024', '2025'], series: [{ id: 'subscriptions', label: 'Subscriptions', values: [62, 74, 88, 103, 121] }, { id: 'services', label: 'Services', values: [38, 41, 43, 44, 46] }] },
  annotations: [{ kind: 'cagr' }],
  options: { variant: 'stacked', title: 'Subscriptions carry the growth', subtitle: { measure: 'Revenue by line' }, unit: '$m' },
};

export function RevenueMix() {
  return <BoardplotChart spec={spec} size="container" fit="fill" fallbackSize={{ width: 960, height: 540 }} />;
}
```

The entry stays small because it links no chart engine and no chart schema. `BoardplotChart` reads the type a spec names and fetches three chunks. Spec validation — the document parser, the diagnostics and zod — serves every type, so a page loads it once. The type's data and options schemas are their own chunk, and its engine a third. A grid's engine links no panel engine: it fetches the engines its panels name, all at once. The repository's package check (`npm run smoke:package`) prints the current sizes of the entry and of the first chart of each type. Until the chunks arrive it draws the busy placeholder, the box a refused chart uses with the wording of `strings.loading`; in the browser an engine the page already holds needs no second wait. A server pass always draws the placeholder, whatever that server loaded for an earlier request, so its output stays the same as it warms up and hydration matches it; `prepared` is no exception, because a prepared chart's request is resolved against the type's registration before its scene is attached. Put a chart in the server HTML with the type's own component, such as `ColumnChart` from `boardplot/react/column`. A chunk that does not arrive leaves the diagnostic card in the chart's place and the next render asks for it again.

`BoardplotTheme` sets the theme, locale and built-in wording for every chart below it. The language sets words only: `locale="de-DE"` prints `1,234.5`, and `locale={{ language: 'de-DE', decimal: ',', thousands: '.' }}` prints `1.234,5`. For server rendering, `prepareChart` lays the chart out once on the server; pass its result as `prepared` with the same props, and the first client render reuses it. `prepareChart` and `parseChartSpec` return promises, because they load only the types the spec names.

```tsx
import { BoardplotTheme } from 'boardplot/react/theme';
import { BoardplotChart } from 'boardplot/react/spec';
import { parseChartSpec, prepareChart } from 'boardplot/react/prepare';

const spec = { type: 'bar', data: { categories: ['North', 'South'], series: [{ id: 'orders', label: 'Orders', values: [42, 35] }] } };
const sizing = { size: 'container' as const, fit: 'content' as const, fallbackSize: { width: 800, height: 450 } };

export async function Orders() {
  const prepared = await prepareChart({ ...(await parseChartSpec(spec)).request, ...sizing }, { theme: 'notation' });
  return (
    <BoardplotTheme theme="notation">
      <BoardplotChart spec={spec} {...sizing} prepared={prepared} />
    </BoardplotTheme>
  );
}
```

A host that draws its own card around a chart switches Boardplot's frame text off: `title: false`, `legend: 'none'`, `footnotes: false`, and no `subtitle` or `source`. `footnotes: false` also leaves off the method notes Boardplot derives, and the info lint `footnotes-off` names each one so the card can print it; the render's notes list holds them all. A disclosure that `notes.show` prints stays: a table's rounding note, a partial period, values the chart does not print. The source line and a required map credit stay: leave `source` out for no source line, and a map licence credit cannot be switched off. `legend: 'none'` leaves off the key of a table, heatmap, cohort or variance, and the scatter size key, and the info lint `legend-off` names that key and its entries so the card can draw its own.

An invalid spec renders an error card with the same errors the CLI returns. Each type also has its own component with flat props, such as `WaterfallChart` from `boardplot/react/waterfall`, which takes `data`, `annotations` and the options as props (`title`, `unit`, `valueAxis`). Such a component refuses a prop its type does not take with the same `unknown-option` card. It checks the keys and leaves the option values and a grid's panel options to the spec path. Props, container sizing, server preparation and export to SVG, PNG and PDF are in [the React reference](reference/react.md).

A `dimswitch` row id is `JSON.stringify([variant, memberId, measureId])`; a member row in by-member omits `measureId`. React `onRowSelect` and `isRowSelectable` get these ids, and `dimswitchRowId(variant, memberId, measureId)` builds them (exported from `boardplot`).

A per-type entry is the small one: it links its own chart and the shared layout core. A page pays for the core once, and each further type adds only its own engine. Two core modules are not in that load, because most charts never reach them. The annotation placement engine, with the event lane, loads when a chart carries an annotation (an event included), a value line, a target or a derived callout. The checks a PATCHED theme goes through load when a caller passes `theme={{ preset, overrides }}`. Pareto and likert are the two types that need one on every chart — the cumulative threshold line and the statement-label theme patch — so their entries link it rather than fetch it. While such a chunk loads the component draws the busy placeholder and then the chart, byte for byte the chart it drew before; a graph that already links the module — the CLI, the MCP server, `boardplot/react/prepare`, the `boardplot/react` barrel — never waits in the browser. A server pass, and the client pass that hydrates it, count only what the chart's own entry links, because a server process can hold a module that the page in the browser does not: `renderToStaticMarkup` of an annotated chart or a patched theme from a per-type entry (`boardplot/react/<type>`) writes the placeholder unless the component gets `prepared`, and the chart follows once the page has hydrated. The barrel's components draw it, because the barrel links both modules.

### Rows in React

Every chart component takes query rows in place of `data`, with the same `columns` and the same refusals as `rows` in `boardplot_render`. `data` is then the template: a series it already names keeps its label and colour role. A SQL date column can be the category and the date at once, `columns: { category: 'month', date: 'month', series: 'product', value: 'revenue' }`; the months then print as 'Jan', 'Feb' and so on.

```tsx
import { LineChart } from 'boardplot/react/line';

const rows = [
  { week: '2026-W40', channel: 'Search', revenue: 120 },
  { week: '2026-W40', channel: 'Social', revenue: 80 },
  { week: '2026-W41', channel: 'Search', revenue: 135 },
  { week: '2026-W41', channel: 'Social', revenue: 95 },
];
const columns = { category: 'week', series: 'channel', value: 'revenue' } as const;

export function WeeklyRevenue() {
  return <LineChart rows={rows} columns={columns} title="Search leads every week" unit="$k" size="container" fit="fill" fallbackSize={{ width: 960, height: 540 }} />;
}
```

`onRowsReading` receives the reading: the row count, the columns no role names and the cells a `state` column suppressed, because the chart draws a suppressed cell as an empty one. Rows that do not map draw the error card with the CLI's `code` and the row, such as `invalid-value` at `rows.3.revenue`. `BoardplotChart` takes `rows` and `columns` too, beside a bare chart spec. The mapping loads as its own chunk the first time a chart gets rows, so a page without rows does not pay for it; `prepareChart` takes the same rows for a server render. [Rows from a query](reference/react.md#rows-from-a-query) has the details.

`specFromRows` from `boardplot/rows` runs the same mapping as a function, in the browser or in Node, and returns `{ spec, reading }`: use it to build a spec yourself, for example in a server component. Rows that do not map throw an `InputError` with the CLI's `code`, message and `details.path`, such as `/rows/3/revenue`. The entry links no chart engine and no zod. It reads no file: `rowsFile` is for the CLI and the MCP server. It checks a choropleth's region ids when the page has imported the map pack (`boardplot/geo/<id>`), and leaves a tilemap's region ids to the chart, which refuses an unknown region when it draws. `specFromRows` is also exported from `boardplot`.

### Small bundles

With esbuild 0.28.2, code splitting, minification and React external, a column's first load through `boardplot/react/spec` is about 408 kB gzip. The initial entry is about 243 kB; validation adds about 88 kB, of which about 32 kB is zod, then the column schema and engine load. The validation chunk is shared across chart types. Importing `ColumnChart` from `boardplot/react/column` starts at about 237 kB gzip and links no zod. These sizes assume code splitting, the default in the production builds of Vite, webpack and Next.js; a bundle without splitting inlines the chunks a chart loads on demand and is about 57 to 87 kB larger per chart type. These are package measurements with gzip level 9; the host build can produce different chunk sizes.

`boardplot/react` registers every chart core when it loads, so a page that imports it links the whole catalogue, whatever it draws. For a small page, import each chart from its own entry, or draw through `BoardplotChart` from `boardplot/react/spec`. Take the theme provider and the other shared pieces from `boardplot/react/theme`: `BoardplotTheme`, `useBoardplotTheme`, `ScaleGroup`, `useScaleGroupPlan` and `SceneRenderer`. That entry registers no chart core, so the page links only the cores it draws. Bundle with code splitting, as the production builds of Vite, webpack and Next.js do. A per-type entry loads the annotation engine, the checks a patched theme goes through and the hover and data-table records on demand; a single-file bundle inlines them into the page for every chart type, and `BoardplotChart` then inlines every engine. `useChartLayout` lays out any type by name and registers every core; it stays in `boardplot/react`.

```tsx
import { BoardplotTheme } from 'boardplot/react/theme';
import { ColumnChart } from 'boardplot/react/column';

const data = {
  categories: ['2021', '2022', '2023', '2024', '2025'].map((year) => ({ id: year, label: year })),
  series: [
    { id: 'subscriptions', label: 'Subscriptions', values: [62, 74, 88, 103, 121] },
    { id: 'services', label: 'Services', values: [38, 41, 43, 44, 46] },
  ],
};

export function RevenueMix() {
  return (
    <BoardplotTheme theme="notation">
      <ColumnChart data={data} variant="stacked" annotations={[{ kind: 'cagr' }]} title="Subscriptions carry the growth" unit="$m" size="container" fit="content" fallbackSize={{ width: 800, height: 450 }} />
    </BoardplotTheme>
  );
}
```

### Export fonts

The React SVG export copies the page's web fonts that its text draws with into the SVG, as `@font-face` rules with `data:` URLs. It copies only the families, weights, styles and `unicode-range` slices that the text uses, each as the whole font file the page loaded. A file opened in a browser on another machine then draws the same face with the measured spacing. A family the machine lacks is skipped. An installed system family ends the stack for text in Latin-1 and general punctuation, which every system font draws, so the export copies no later web font for it; text with other characters keeps the later web fonts, which draw the glyphs the system family lacks. The built-in presets name system fonts only, so their exports add no bytes. A web font adds its file size plus a third for the base64 encoding: the variable Geist Latin file (29.4 kB, every weight) adds 39.3 kB to each SVG. Pass `embedFonts: false` for the plain SVG, for example when the page that shows it already loads the font, or when the font licence forbids copies in documents. Design and slide tools that import SVG can ignore embedded fonts; use the PNG there when the font is not installed.

Before export, the React export checks `document.fonts.check()` for the theme font stack. If the check fails, it warns once per page and font stack through `console.warn`, the existing export warning channel, and the file carries no copy of that font. Load the font before export. The check does not prove that an undeclared font is installed; see the [CSS Font Loading specification](https://www.w3.org/TR/css-font-loading/#dom-fontfaceset-check). The PNG export paints the SVG with the same font copies, also with `embedFonts: false`. If a loaded font file cannot be read (a style sheet from another origin, a `FontFace` built in script, a failed fetch), the export warns and the text draws a fallback font.

The CLI and MCP SVG names the theme font stack and embeds no font; their PNG draws with the fonts installed on the machine. For a brand web font, either export from React, or install the font on the machine that renders and pass `--font-tables` from `boardplot fonts build` ([Custom fonts](FONTS.md)), then hand on the PNG.

## Story steps

Wrap a chart with `withStory` from `boardplot/react/story` to show `options.story.steps` with Back and Next controls. Each step uses the authored `title` and optional `body`. The marks stay in place. Back stops at the first step. Next stops at the last step.

The panel stays outside the plot. Wide charts reserve a 240–320 px right column. The S width class, or a chart that cannot give up that width, puts the panel below the x axis at the full plot width. Automatic height grows for the panel. Fixed height reduces the plot toward its measured minimum. If the panel still does not fit, its body loses lines first, down to zero. Then its title clamps to one line. The button row stays. The chart refuses only when this minimum panel and the plot cannot fit. The panel uses the background and grid tokens with a 6 px radius. Next uses ink with background text. Back has a hairline outline. Hover paint runs only on devices that support hover; pressed paint uses theme tokens.

Use Tab to focus the story or either button. Left and Right move between steps. The story declares these keys with `aria-keyshortcuts`. The story and buttons have a 2 px focus ring with a 2 px offset, in the theme's `ink` colour. Each HTML button has a minimum 44 × 44 CSS px hit box. Back grows left and Next grows right, so the hit boxes keep their gap when the SVG shrinks. The drawn buttons are at least 44 px high. Their labels wrap when needed. The counter sits on the left. Back and Next sit on the right with an 8 px gap. If the row is too narrow, the counter moves above the buttons.

The polite live region announces `Step N of M: title. body`. Set `strings.storyStep` to author the position wording. It accepts `{step}` and `{count}` without zero padding. Defaults are `Step {step} of {count}` in English and `Schritt {step} von {count}` in German. A chart string overrides the React theme provider string. The drawn counter uses `strings.storyCounter`, with the default `{step} / {count}` and no zero padding. There is no progress bar. A single step shows only the title and body, without buttons or a counter.

The panel shows up to four title lines and ten body lines. A cut title or body reports `story-text-truncated` with the step id and field path. Shorten that field or give the panel more width. The live region retains the full authored title and body.

## Notes under the chart

Boardplot sorts every note under a chart by kind. In the live React chart, the render target decides how much of it the frame prints. A React chart with `fit="content"` takes its height from its content and prints the footer of the static image: every note of the kinds `notes.show` lists, in full, with no line budget, so it is as tall as `boardplot render` at the same width. Under `notes.placement: 'info'` a "Notes and sources (N)" button opens the notes the image does not print; it sits in the space the image leaves free for it.

Boardplot prints none of its own notes under a chart by default, on every target and surface: the `method` and `disclosure` notes go to the notes list only. `notes.show` prints them where the author asks for them. A spec that asks for notes another way gets them too: `methodNote: true` or an authored `notes.placement` prints the method notes and disclosures, as `notes.show: ['note', 'method', 'disclosure']` does. A changed note wording alone (`strings.incompleteStacks`) prints nothing. Static SVG, PNG and clipboard images print the full author notes, the kinds `notes.show` adds, the source and the credit. Compact charts retain note reference numbers. Grid panels move notes that do not fit into the outer footer, under the panel title and ID. They have no notes button or "+N notes" pointer. The notes start at the normal footer gap below the chart's last element. They use the existing footer space first. If they need more room, the canvas grows below its original boundary. The plot keeps its position and size. `footnotes: false` still suppresses notes other than the disclosures `notes.show` prints.

| Kind | What it is | Where it goes |
|---|---|---|
| `note` | Your `footnotes`, in your order | The frame, within the line budget |
| `method` | Boardplot's text on how a number is built (likert net, the pvm split) | The notes list; `notes.show: ['note', 'method']` prints its one-line short form |
| `disclosure` | Boardplot's text on how to read the chart: a key to an encoding ("One cell = 5%", "W38 partial", "Columns by rank"), a change to the data ("1 value below zero shown as 0."), or the marks the drawing leaves unlabelled ("Not labelled on the chart: ...") | The notes list and its warnings (`values-in-note`, `labels-as-ranks`); `notes.show` with `'disclosure'` prints it in the frame, outside the line budget |
| `source` | Your `source` | Always in the frame, last line |
| `credit` | A map pack's licence credit | Under the source line when the licence requires it (de-states, us-states), else the notes list |

The line budget counts the notes and the source line; a required credit and a disclosure do not count. A numbered author note that a mark on the chart points at ("1)" beside a category) prints on every target, like a required credit. A mark that points at one of Boardplot's own notes prints only where that note prints: without `'disclosure'` in `notes.show`, a column row draws no rank numbers and no note mark on a cut name, a gantt milestone keeps its diamond without a key number, a table head drops its † and a dimswitch period its *. `footnotes: false` keeps a disclosure that `notes.show` prints; it leaves a pointed note off with the other notes and hands it to the host in the `footnotes-off` lint. Report and dashboard take 3 lines (2 under 720 px wide), slide 2 and print 3. A note that does not fit moves to the notes list with every note after it, and the source line ends with "+N notes". The pointer counts only the hidden notes of the kinds `notes.show` prints. A slide prints only the source line, the credit and the pointer by default (`notes.placement: 'list'`); set `notes.placement: 'frame'` for its 2 lines of notes.

Every render returns the notes list, so a host can build an appendix or a backup slide from it: `notes` on each chart of the CLI and MCP result, `notes` in the reading, and `geometry.frame.noteList` in the library. Each entry is `{ n, kind, text, short, inFrame }`; a credit adds `links`, and a note the chart numbers adds `ref`, the number it prints with.

For example, in a live React layout, a likert chart's net note reads `{ "n": 3, "kind": "method", "text": "Net = share on the agree side minus share on the disagree side, in percentage points; the neutral option counts on neither side.", "short": "Net = agree minus disagree, in points.", "inFrame": false }`. Static output prints the full text and sets `inFrame` to `true` where `notes.show` lists `'method'`.

The options:

- `notes.placement`: 'frame', 'list' or 'info'. 'info' is the dashboard default: in React one line holds the source and a required credit, and a "Notes and sources (N)" button opens a panel with every other note, Boardplot's hidden notes included. Static output and a content-fit React chart print every note of the kinds `notes.show` lists for all three placements. Under 'info' a static footer (except a table's) keeps the width of the button free after the source line or its last line, or an empty row under its last line where the button fits after neither; a content-fit React chart puts the button in that space, and it opens the notes the footer does not print. `onNotes` and `renderNotes` still hand the host every note.
- `notes.maxLines`: the live chart's line budget. Static output and a content-fit React chart have no line limit.
- `notes.show`: the kinds the frame prints, default `['note']`, on every surface; `['note', 'method', 'disclosure']` where the spec sets `methodNote: true` or `notes.placement`. An authored `notes.show` always decides alone. Add `'method'` for the method notes and `'disclosure'` for the disclosures, for example `notes: { show: ['note', 'disclosure'] }`. On a pinned height, printed disclosures never take the plot under its floor: the chart refuses with `size-below-floor` and the height that seats both. On an open height the chart still gets the height a printed disclosure would take when the labels need it, so a hidden note does not cost a label.
- `notes.pointer`: false drops "+N notes", and in React the button and panel. Static output always has the full notes and no pointer.
- `notes.maxListed`: the items a disclosure names before it counts the rest, default 8. `'all'` names every item; `0` only counts them.

The de-states pack prints "Map: © BKG (2026) dl-de/by-2-0 (data changed), Datenquellen: <URL>" in SVG, PNG and PDF at every width, and under `footnotes: false`. React shows the full credit at every width and in print. The credit wraps as needed, with "BKG", "dl-de/by-2-0" and "Datenquellen" as links. The us-states pack prints "Map: U.S. Census Bureau (2025)". The Natural Earth packs (eu27, europe, world, dach) need no visible credit; theirs is in the notes list. NOTICE.md has the full licence texts.

In React the footer is HTML under the SVG. `onNotes(notes)` hands a host the list whenever it changes, and `renderNotes(notes)` draws the notes in place of the button and panel; the source line and a required credit stay under the chart. The panel opens by click or Enter, closes with Esc, and print CSS opens it.

A host's own document capture Escape handler runs before the browser closes the popover; the host should ignore Escape while it contains `[popover]:popover-open`.

## Sizing

Pick the target, give the slot size. The target names the medium the chart is read in. It sets the type sizes, the readability floors and the default canvas. The slot is the space the host gives the chart. Boardplot lays the chart out at that size, so its text keeps the size the target sets.

| Medium | Target | Slot size | CLI flags |
|---|---|---|---|
| HTML report, Claude Artifact, email | `report`, the default | Column width in px, for example 680 to 720 | `--width 700` |
| Dashboard card | `dashboard` | The card. In React, `size="container"` measures it | `--target dashboard --width 480` |
| Slide picture | `slide` | Picture box in pt | `boardplot render spec.json --target slide --width 660pt --height 360pt`; a PNG at the default `--scale 2` |
| Print or PDF | `print` | Print area in mm | `--target print --width 180mm --height 110mm --scale 3.125` (300 dpi) |

Set the target with `--target` on `boardplot render` and `boardplot measure`, with `target` on `boardplot_render` and `boardplot_measure`, with `options.target` in the spec, or with the `target` prop in React. `BoardplotTheme` passes its `target` to the charts below it. A target given to the call wins over `options.target`, which wins over the provider. Without one, the target is `report`.

`options.textScale` multiplies every text the chart draws: title, subtitle, labels, axes, legends, notes, source, event lanes, KPI figures and eyebrows, and the table faces, the theme's absolute `table` sizes included. It takes 0.5 to 2.5; 1, like no value, keeps the target sizes, and 1.25 sets every text 25 % larger. The layout runs again at the new sizes, so lines wrap, labels move and ticks thin as they need to; the canvas keeps the size you give. A theme override of one role still works, and `textScale` multiplies it too. A scale under 1 stops each text at the target's readability floor (11 px for most report text), so it never draws text under it; a scale above 1 raises the floors with the text. In React, `BoardplotTheme` passes its `textScale` to the charts below it, the table grid and the hover cards included, and a chart's own `textScale` wins. `geometry.presentation.textScale` carries the scale the chart drew at (absent at 1), for HTML that a host prints beside the chart. `textScale` multiplies the size of the chart's width class, so charts of different widths draw different sizes at the same scale: at 1.4 a 1010 px chart sets its labels at 18.2 px and a 560 px chart at 15.4 px. For equal text, use `textSize`.

A theme override of `type.secondary.size` sets the key text size. An override of `type.footnote.size` sets the note and source text size. These sizes take priority over the frame defaults.

**Equal text across charts on one page or slide.** `options.textSize` pins the primary label size in px, the same at every width, from 6 to 32. Every other text role keeps its ratio to the primary label in the middle width class (720 to 1079 px): on the `report` target, `textSize: 13` draws a 560 px chart with the sizes a 1010 px chart has. A chart of 1080 px or more draws smaller than its default under `textSize: 13`, because its default class is larger. On `slide` and `print`, `textSize` is in layout px, not pt. Set the same `textSize` on every chart of the page or slide, on `BoardplotTheme` for all charts below it, or once on a grid, where it applies to every panel; a panel that sets another value is refused. It works on every chart type, in `boardplot render`, `boardplot measure`, the MCP tools, the API and React. `textSize` and `textScale` together are refused: keep one. The floors stay: a `textSize` under the target's sizes stops each text at its floor.

`--width` and `--height` take a number of px, or a number with `px`, `pt` or `mm`. The MCP `width` and `height` are px; put a physical size in `options.size` with its `unit`. 1 pt is 96/72 px and 1 mm is 96/25.4 px. A width alone leaves the height automatic. Over a pinned height, a width alone keeps that height; over a size preset, it keeps the preset's shape (`slide-4x3` at `--width 840` draws 840 × 632 px, the same ladder step).

```json
{
  "type": "column",
  "data": {
    "categories": ["2024", "2025"],
    "series": [{ "id": "revenue", "label": "Revenue", "values": [120, 135] }]
  },
  "options": { "title": "Revenue grew 12.5 percent", "unit": "$m", "target": "slide", "size": { "width": 660, "height": 360, "unit": "pt" } }
}
```

The answer gives the size in layout px: 660 × 360 pt is 880 × 480 px.

```json
{ "ok": true, "size": { "width": 880, "height": 480 } }
```

The layout width selects a class: S below 720 px, M from 720 px, L from 1080 px. In the M class, title, label, axis and footnote are 20, 13, 13 and 12 px for `report`; 18, 13, 13 and 12 px for `dashboard`; 20, 14, 14 and 10 pt for `slide`; and 16, 11, 11 and 9 pt for `print`. KPI and bullet use the M sizes at every width. To fit, the engine wraps, moves or discloses labels; it never sets text below the target's floor. A chart that still does not fit is refused with the size it needs. A theme that sets a smaller size renders with one warning.

Without a size, `report` starts at 720 × 405 px and `dashboard` at 480 × 270 px; both take the height their content needs. `slide` is fixed at 888 × 396 pt (1184 × 528 px), the content frame of a 960 × 540 pt slide. `print` is fixed at 267 × 180 mm, landscape A4 inside 15 mm margins. The presets `slide-16x9` (720 × 405 px), `slide-4x3` (720 × 540 px), `a4` (1052 × 744 px) and `dashboard` (480 × 270 px) keep their sizes. `a4-landscape-content` (267 × 180 mm) and `a4-portrait-content` (180 × 267 mm) are new. A preset sets the size, not the target: use `target: "print"` with the A4 content presets. A full slide is `size: { "width": 960, "height": 540, "unit": "pt" }` with `target: "slide"`.

The SVG `viewBox` is in layout px. Its `width` and `height` are px for `report` and `dashboard`, and pt for `slide` and `print`, so the host places it at the slot size. A PNG has `scale` pixels per layout px, 2 by default for every target, and records 96 × `scale` dpi. Raster density does not change the text size or the placed size: a 660 × 360 pt chart at `--scale 4` is still 660 × 360 pt with 14 pt labels. Printing a `report` chart does not give it print type; render it again with `target: "print"`.

The SVG shrinks to a narrower container, and its text shrinks with it. An SVG may shrink by about 10 % at most before it warns, and a floor can allow less. `embed.width` declares the CSS px width the host shows the chart at; the render warns `type-below-effective-min` when that width is below the safe minimum. Do not change `embed.width` to remove the warning; render at the slot width instead. In code, `geometry.presentation` holds the target, the class, the natural size and `minDisplayWidth`, the narrowest CSS px width that shows the chart without a warning. A static SVG cannot know the width it gets.

A chart in a narrow phone layout needs a new layout, not shrinking. Render it again at the phone width, where many types draw in compact mode; use a simpler chart; or keep a readable minimum width with horizontal scrolling or a full-size view.

Each type has a floor, `minWidth` × `minHeight` in layout px, and a fit, listed by `boardplot_list` and `boardplot_describe`. A `fill` type uses the whole frame. A `content` type such as `bar`, `table` or `kpi` takes the height its rows need.

The width floor of a row chart (bar, bartable, funnel, butterfly, likert, gantt, cohort, heatmap) and of a band chart (waterfall, pareto, variance, pyramid, box, mekko, pvm) is the width its content measures, and never less than the card minimum of 280 px. The chart draws full where its content fits. Below that it draws compact, and it is refused only when compact does not fit either; the refusal names the size compact needs. This also holds for a width alone. Every row and band type has a compact form, except mekko, whose `mode` names its calculation, and bullet, which compacts only by `density: 'compact'`. A horizontal waterfall and a status grid keep a 480 px floor for now. A bullet chart's width floor is the width its rows measure. A diagram draws on a card down to 280 px when no card or group text is cut and no group frame overlaps another there; otherwise it keeps a 480 px floor. A node, group, caption, badge or edge label that the narrow card would hide, or an edge label it would cut, also keeps the 480 px floor. Column, line, combo, histogram, scatter and dot keep a 480 px floor and draw below `minWidth` or `minHeight`, on either axis, down to a `compactFloor`. A pie keeps its 320 px height floor for an automatic height; a pinned pie draws compact below it, down to 160 px, while its circle keeps a radius of at least 36 px. A pinned slope draws compact under its 270 px height floor, down to 180 px, while its plot keeps 80 px; with an automatic height it takes its content height. An authored grid of several columns that refuses under 480 px draws compact: its panels stack in one column, in authored order, down to the width its widest panel measures. Metric stacks, category tiers, legacy facet grids and grids with `anchors` or `alignmentRules` have no compact form.

Compact mode sets minimal labels, tight spacing and the key in the footnote size. It keeps the series key, the whole title and the subtitle; a canvas too short for them is refused with the height they need. A `fill` chart in compact mode keeps a plot of at least 80 px, whichever side of the canvas is short. On a fixed width and height a canvas that cannot hold it draws the plot under that floor, down to the type's hard minimum (step 7 under "Fixed height"), and warns `plot-under-floor` with the height it needs. `belowMinimum: 'refuse'` refuses below the measured floor instead of drawing compact. A type without a compact floor refuses below its minimum. Every refusal names the minimum it needs.

### Frame text, key and automatic height

These rules apply on every target.

- The title is never cut. It wraps to three lines; a title that needs more takes more lines. The subtitle wraps until every word shows. The frame grows; the plot does not shrink for it.
- A chart with two or more series always names them: a key row or a direct name at each series. Compact mode keeps the key, in the footnote size, and keeps an explicit `options.legend`. A line whose end names do not fit puts its key in a row above the plot at 480 px wide and narrower, never beside the plot.
- A grid panel names its own series when its title names its one series, when a line or combo draws an end label with the name of every series, or when the panel draws its own key row. A grid whose panels all name their series draws no grid key under `legend: 'none'`. Otherwise the grid key row lists only the series no panel names, and the info lint `grid-legend-required` names them. A grid with no `legend` set follows the same rule when a chart panel draws two or more series.
- An automatic height (no height, or a width alone) reserves the plot first. The plot gets at least half of the canvas and at least 160 px (`dashboard`: 140 px). Title lines, key, annotations and notes then grow the canvas. A `fill` type starts at its own minimum height, never at a 16:9 strip of a narrow width, and at card widths (under 480 px) a fill chart is never shorter than at 480 px, compact or full. Pie, waffle, choropleth and tilemap take the height of their content, and a sparkline card with an authored width scales its trend band with that width: their marks scale with the width, so a narrower card of these can be shorter. Wider charts keep their aspect height. A chart whose plot does not take more height (variance tiers) keeps its start height. A `content` type keeps the height of its content; at card widths a butterfly, diagram, funnel, grid, heatmap, KPI or status card is never shorter than at the next wider card step (400, then 480 px). A grid of fill panels also keeps the plot floor. When title, key, notes and the axis-label row take more of a fill chart's automatic height than the furniture budget (half of the canvas under 720 px, 40% from 720 px), the chart grows to the smallest height inside the size ladder that keeps the budget, never past the tallest ladder step; where no such height exists, the `furniture-budget` warning stands.

### Fixed height

A slot with a fixed height (`options.size.height`, a size preset, or a host height in React) never grows. When the content does not fit, the chart gives up optional parts in this order:

On a fixed compact card, the plot first tries its hard minimum with the source line and subtitle still on the canvas. A rectangle treemap also gives up its 160 px plot floor before it refuses the card. Text keeps its size floor. `belowMinimum: 'refuse'` keeps the full floor.

1. Value labels thin to the few the compact mode keeps.
2. Axis ticks thin with the plot height.
3. Notes move to the notes list; the source line ends with "+N notes". A compact frame then puts the source on one line, and as the last footer step moves it to `frame.source` for the host (the info lint `footnotes-off` names it).
4. The key takes the footnote size, so more entries fit in one row.
5. The plot shrinks to its floor.
6. The subtitle moves into the notes list (warning `subtitle-moved-to-notes`). It stays readable there and in the React notes panel. The source line stays with the host, as step 3 left it. A unit line ("Revenue in $m" without the measure) can stay on the canvas.
7. The plot goes under its floor, down to the type's hard minimum: a bar's rows get thinner than its segment labels need, and labels that do not fit are hidden. A column, line, combo, histogram, scatter or band chart keeps a plot of at least 40 px with room for two value-label rows, which holds two labelled value ticks; its other measured needs (end labels, rows) still apply. A value label that loses its seat goes to the note, as the note rules say.

The title is never cut and the key is never dropped. When the plot ends under its floor (160 px, `dashboard` 140 px), or a row type draws at its hard minimum, the chart is still drawn and warns `plot-under-floor`. Rendering gives an estimated height from the drawn frame and a `fix` that sets it. Use `measure` for the exact verified size. Only when step 7 still misses is the chart refused with the size it needs (`size-below-floor`). Steps 6 and 7 apply on a fixed width and height in compact mode. At step 7 a heatmap row drops its 28 px comfort height to its text line and 2 px, and a dot row keeps 1 px of air instead of 4.

In React the HTML footer takes exactly the height the layout reserved for the footer it replaces, and the notes panel opens over the chart, so a chart in a fixed-height slot never grows past it. A React container without a host height hands the engine its width alone, so it takes the same automatic height and plot floor as the CLI.

A size up to 0.5 px under a minimum still fits, for every type. A browser lays a card out in fractions of a pixel, and 777.98 px for a 778 px minimum draws. A refusal prints whole pixels.

`boardplot_measure` reports the size a spec needs without drawing it:

```json
{
  "name": "boardplot_measure",
  "arguments": {
    "width": 400,
    "spec": {
      "type": "waterfall",
      "data": { "items": [{ "id": "fy24", "type": "total", "value": 120 }, { "id": "price", "value": 18 }, { "id": "fy25", "type": "total" }] }
    }
  }
}
```

```json
{
  "minWidth": 280,
  "minHeight": 270,
  "naturalWidth": 280,
  "naturalHeight": 334,
  "fit": "fill",
  "compactFloor": { "width": 280, "height": 180 },
  "mode": "full",
  "refused": null
}
```

`measure` reports two minimum heights. The minimum height depends on the width: text wraps, and notes grow with the frame. So `minHeightAtWidth` is the height needed at exactly the width you asked for (the minimum width when you asked for less): a chart pinned at that width and that height draws in full mode. `minHeight` is checked at the minimum width as well, so a chart pinned at `minWidth` × `minHeight` draws too. In a wide slot `minHeight` can be taller than the slot needs, because the narrow case sets it. A 280-day combo at 1168 px wide reports `minHeight` 522, `minHeightAtWidth` 404 and `naturalHeight` 657. Do not read the minimum from a layout that was drawn taller (`geometry.sizing`): it holds for that frame only. `canDraw` answers a size refusal with the same at-width height when the request has a width.

Which value to use for a card:

| Value | Meaning | Use it for |
| --- | --- | --- |
| `minHeightAtWidth` | The height that draws in full at the width you asked for: every hidden value is named in the note. A pinned height a little below it can still draw, with a note that counts the hidden values instead of naming them; `canDraw` tells you. Lower still, the chart is refused, or drawn compact when the type has a `compactFloor`. | The floor of a dashboard card. |
| `minHeight` | A height that draws at this width and at `minWidth`. | A floor that must also hold when the card gets narrower. |
| `naturalHeight` | The height the chart wants at this width: its aspect height for a fill chart, the height of its content for a content chart, and never under `minHeight`. | The target height for a dense chart: many categories, a long footer, an event lane. |
| `comfortableHeight` | 1.25 × `minHeight`. | Spare room for longer labels. |

`size.height` is the height the chart draws at the width you asked for. A spec that pins a height taller than its chart needs (a circle treemap is bound by its width; a bullet panel or a Gantt chart stops at its row height) leaves the rest of the frame empty on render. `measure` does not report that empty part: `size.height` is the least height whose drawing has the same marks and words, and `naturalSize.height` follows it. A chart that grows with the frame, or a spec with no pinned height, keeps its height. Size a host frame from `size.height` and the pinned spec will not leave empty bands.

A dense chart grows with its data. Do not give it a fixed small height such as 300 px. Measure at the width of the card slot, use `minHeightAtWidth` as the floor and `naturalHeight` as the target. If the slot cannot be that tall, show a chart with fewer categories or events, or let the card scroll. Do not shrink the chart.

Below the floor a render is refused. It draws nothing and returns one error that names the pixels it needs, with a `fix` that sets them.

```sh
boardplot render - --width 240 <<'EOF'
{ "type": "waterfall", "data": { "items": [{ "id": "fy24", "type": "total", "value": 120 }, { "id": "price", "value": 18 }, { "id": "fy25", "type": "total" }] } }
EOF
```

```json
{
  "ok": false,
  "errors": [{
    "code": "size-below-floor",
    "path": "/width",
    "suggest": "Pass width 280.",
    "fix": [{ "op": "replace", "path": "/width", "value": 280 }]
  }]
}
```

Rendering at 280 pixels or more draws the chart. In React, `size="container"` lays the chart out at the size of its parent element, `fallbackSize` sets the frame for the server output and the first render, and a chart that does not fit its parent shows a placeholder until the parent is wide enough. The measured size is the layout size; Boardplot does not read the host's font size. A fixed-size chart does not grow past its natural width, and `onWarnings` reports a display narrower than its safe minimum.

### Type sizes and floors

The target and the width class set the default type sizes. `report` and `dashboard` sizes are layout px; `slide` and `print` sizes are pt. Sources use the footnote size. Secondary text (ticks, axis titles, background series labels) uses the secondary size. The font family, weights and line heights come from the theme.

<!-- BEGIN GENERATED TYPE SIZES -->
<!-- Generated by scripts/generate-reference.mjs from TARGET_TYPE_TABLES in src/core/target.ts. -->
| Target | Unit | Class | Title | Subtitle | Label | Axis | Secondary | Footnote/source | Micro |
|---|---|---|---|---|---|---|---|---|---|
| `dashboard` | px | S | 16 | 13 | 13 | 13 | 13 | 12 | 11 |
| `dashboard` | px | M | 18 | 13 | 13 | 13 | 13 | 12 | 11 |
| `dashboard` | px | L | 20 | 14 | 14 | 14 | 14 | 12 | 11 |
| `report` | px | S | 17 | 13 | 12 | 12 | 11 | 12 | 12 |
| `report` | px | M | 20 | 14 | 13 | 13 | 12 | 12 | 12 |
| `report` | px | L | 22 | 15 | 15 | 15 | 13 | 13 | 13 |
| `slide` | pt | S | 18 | 13 | 13 | 13 | 13 | 10 | 11 |
| `slide` | pt | M | 20 | 14 | 14 | 14 | 14 | 10 | 11 |
| `slide` | pt | L | 22 | 14 | 14 | 14 | 14 | 11 | 11 |
| `print` | pt | S | 14 | 10 | 10 | 10 | 10 | 9 | 9 |
| `print` | pt | M | 16 | 11 | 11 | 11 | 11 | 9 | 9 |
| `print` | pt | L | 18 | 11 | 11 | 11 | 11 | 9 | 9 |

The engine never fits text below the floor of its target. The floors apply to the size the reader sees, after display scaling.

| Target | Unit | Title | Subtitle | Label | Axis | Secondary | Footnote/source | Micro |
|---|---|---|---|---|---|---|---|---|
| `dashboard` | px | 14 | 12 | 12 | 12 | 12 | 11 | 11 |
| `report` | px | 17 | 11 | 11 | 11 | 11 | 11 | 11 |
| `slide` | pt | 16 | 12 | 12 | 12 | 12 | 8.25 | 11 |
| `print` | pt | 12 | 10 | 9 | 9 | 9 | 8 | 8 |
<!-- END GENERATED TYPE SIZES -->

Table values and data-bearing chips use the label floor. Table headers use the axis floor. Notes and sources use the footnote floor. Ordinary values never drop to the micro size. Text without a typography role uses the label floor.

The KPI hero figure prefers 1.5 × the M title size, rounded in the table unit, and never goes below its minimum. The existing KPI fitting and sibling alignment stay.

| Target | Preferred hero with the default M title | Minimum |
|---|---:|---:|
| `dashboard` | 27 px | 24 px |
| `report` | 30 px | 28 px |
| `slide` | 30 pt | 24 pt |
| `print` | 24 pt | 16 pt |

## Reading errors and warnings

A callout that uses a side other than `preferSide` reports `callout-side-changed` at info level. The warning names the callout and the side used. It does not change placement.

`story-text-truncated` reports a story title cut at four lines or a body cut at ten lines. Its severity is `warn`. It names the step id, the line limit and `options.story.steps[index].title` or `.body`. It reports only the chosen panel layout. The suggested fix is to shorten that field or give the panel more width.

Every error and warning has one shape:

```sh
boardplot render - <<'EOF'
{ "type": "column", "data": { "categories": ["2024"], "series": [{ "id": "revenue", "values": [120] }] }, "options": { "labelDensity": "sparse" } }
EOF
```

```json
{
  "ok": false,
  "errors": [{
    "code": "invalid-options",
    "message": "options.labelDensity: labelDensity accepts one of full, smart, minimal",
    "path": "/options/labelDensity",
    "expected": { "values": ["full", "smart", "minimal"] },
    "received": { "type": "string", "value": "sparse" },
    "docs": "docs/reference/column.md#options",
    "fix": [
      { "op": "test", "path": "/options/labelDensity", "value": "sparse" },
      { "op": "replace", "path": "/options/labelDensity", "value": "smart" }
    ],
    "suggest": "Use one of: \"full\", \"smart\", \"minimal\"."
  }]
}
```

- `path` is a JSON Pointer into the spec you sent.
- `fix` is a JSON Patch. Apply it to that spec as it is, or read `suggest` and change the field yourself. It is absent when the engine has no single repair.
- `docs` names the reference section that describes the field.
- Errors come sorted by path, at most ten, then one `more-errors` entry with the count.

Column, combo, bar and line charts use locale strings for built-in labels and notes. English mean labels read `Average 27.5`. German mean labels keep `Ø`. Set `options.strings.average` to change that word. Other keys cover status labels, missing-value notes, ranks, ranges and anomaly rules. Each key is listed in the reference. `options.strings` also works through the React theme provider. Authored text stays as written. Unsupported languages use English built-in wording.

A partial category is named once, such as `W38 to date`. On combo, column, bar and variance charts, and on a line chart with one line, the words stand under the running value itself where a single value or total prints there and they fit its column; the chart then draws no partial key or axis words. On a time axis (`xAxis.type: "time"`), the words stand under the running value where they have room, else after the end value in the key, else under the reading below the axis, in a row of their own where the tick rows have no room. Otherwise its key comes after the series keys. With no partial key, the chart adds a note. Set `strings.toDate` to change the suffix and `strings.partial` to change a generic partial key. Combo charts hide the default value axis when all column totals are labelled. An explicit `valueAxis.show` still wins. Column and combo category rows try a smaller font before rotation. Combo line end labels stay inside the plot and clear the columns; a moved label has a leader to its point.

Warnings have the same shape, arrive in `warnings`, and leave the drawing in place. `label-hidden`, for example, says the solver dropped a label that had no free space; `derived-mismatch` says an authored total differs from the computed one. A label collision that no size resolves refuses the chart with the error `label-collision`, which names each hidden label and what blocks it. More room does not lift it, so React shows it at once. A size refusal, and a hidden-label refusal that more width can clear, waits in a container that is still growing until the size holds still. A value, a series name, a value line or a pinned label that finds no seat is still on the page: the chart names it in a note, "Not labelled on the chart: North 42 (Q3).". The note is a disclosure: it is in the notes list and the `values-in-note` warning, and prints under the plot, also under `footnotes: false`, where `notes.show` lists `'disclosure'`. It is one note per chart. It names as many items as fit two footer lines at the drawn width, at most 8, reference lines and line end values first, then the rest in data order, and ends with a count, "and 236 more". A lone last item is named instead of "and 1 more" when it fits. When not even one name fits, the note only counts, "18 of 36 values". On a pinned height where the two-line note would push values off the plot, the note counts instead. A callout or note annotation that prints a value with `${value}` is that value's label, so the note does not name the value again. When the height is not pinned the chart first tries more height, so labels that can be drawn are drawn; the cap applies to what is left. Every item stays in the reading's `omissions` and in the hover records. `notes.maxListed` sets the number: `'all'` names every item, and `0` names none and only counts them, "18 of 36 values". `strings.moreListed` sets the wording of the count (a React chart with hover on adds "(hover shows each value)" to the default). The info warning `values-in-note` lists every value and name a chart moved into a note, once per chart, so a check of the warnings sees them. A canvas too small to name them all is refused with `size-below-floor` and the height it needs. `unknown-slot` and `pin-blocked` list a label's valid slots and, apart, the ones free now, so a pin can be corrected from the message alone.

A chart with nothing to draw (no categories, series, rows or points) is reported with the one code `empty-data`, in the CLI and MCP findings, in the layout error and in React. In React, `onEmpty` is called once, and the chart shows `strings.emptyMessage` of the provider (default "No data to show.") instead of an error. `canDraw(request)` from `boardplot` answers without drawing: `{ ok: true }`, or `{ ok: false, code, minimum? }`, where `code` is `empty-data`, `too-many-items` or `size-below-floor` and `minimum` is the size the chart needs, so a host can hide a card. A table with no rows still draws its header and counts as drawn.

A chart whose drawn list holds more than 2,000 entries (the categories of a column, bar, combo, dot, variance, butterfly, funnel, waffle or bartable chart; the rows and columns of a heatmap or status matrix; the rows of a bullet or gantt chart; the items of a pareto, waterfall, likert or treemap chart; the bands of a pyramid; the cohorts of a cohort chart; a likert chart draws at most 500 items, and a mekko chart 20,000 categories) refuses at once with `too-many-items`, at the path of that list. Its layout would take minutes, and no entry would be wider than a pixel. The budget counts what the chart draws: the categories left after `topN` (bar, butterfly, column, mekko, pareto, likert, pyramid), after `viewDomain` and `window.last` on a column or combo, and after a pareto's automatic fold of a crowded tail into Rest. Aggregate the list first, or keep the largest with `topN` where the type takes it. A pie keeps its seven largest slices by default, and a pvm bridge draws aggregate effects, so neither has a budget. A dated line or area samples a long series instead. A line or area also refuses with `too-many-items`, at `/data/series`, when its cost is over 300,000 (drawn categories times series, plus 100 for each series; 1,999 categories by 200 series ran out of memory), or when drawn categories times series times series is over 100 million (300 categories by 700 series is only 210,000 points and still runs out of memory), counted after `viewDomain`, `window.last` and the sampling, so draw fewer series, aggregate the periods or draw part of them. A combo refuses the same way when its cost is over 20,000 (drawn categories times all its series, plus 40 for each series; 300 categories by 51 series take 10 s and 2.1 GB, and 10 by 1,000 do not finish). A column or bar chart with many series keeps its limit on categories only. Tables, scatter, histogram and box plots draw every row.

On a canvas the host pinned, a chart of a type with a compact floor (bar, bartable, box, butterfly, cohort, column, combo, dot, funnel, gantt, heatmap, histogram, likert, line, pareto, pvm, pyramid, scatter, variance, waffle, waterfall) that lacks room in full mode is drawn compact, and refused only when compact does not fit either; the refusal names the size compact needs. `belowMinimum: 'refuse'` keeps the full-mode refusal. A width alone and the fixed default canvas of `target: "slide"` and `target: "print"` count as pinned too. A chart with no size on `dashboard` or `report` grows to its full floor instead.

React reader cards reserve the chart frame. Loading and reader frames scale with the host, as the SVG does; `fixedSize` keeps their intrinsic size. A cold content-sized chart estimates its height from the data row count and row pitch plus fixed space for the chart frame. Pass `prepared` for the exact loading height, including measured text and automatic content height. The message sits in the centre and uses the chart theme. Valid full theme objects keep their tokens even when the spec is invalid. Invalid themes use the default theme. The card keeps a supplied title and source. A long host message shows at most three lines; its `title` attribute keeps the full text. The reader body and host refusal content load when needed. The server and first browser pass use a minimal busy frame with the title and source. This frame inherits host typography and paint; theme resolution and theme tokens load with the reader body. It keeps findings in `data-bp-diagnostics`; individual code and path markers load with the reader body. Developer details load only in full mode.

Set `diagnostics` on `BoardplotTheme` to `auto`, `full` or `reader`. The default is `auto`: it selects `full` when `process.env.NODE_ENV` is not `production`, and `reader` in production. The check also works when `process` is absent. An explicit mode wins. Nested providers inherit the mode unless they override it.

In `reader` mode, size, empty and invalid-spec cards use `role="status"`. They show no paths, codes, minimum pixels, schema values or fix patches. Diagnostics remain in `data-bp-diagnostics`, with codes and paths in `data-bp-error-code` and `data-bp-error-path`. The browser logs diagnostics once per card mount; invalid specs use `console.error`, size refusals use `console.warn`. Each record starts with one line of text, such as `Boardplot refused: size-below-floor: …`, with the code, the path and the message of every finding, and then passes the findings. Server rendering does not log them. These attributes and console records are developer access, not a data security boundary.

In `full` mode, a closed native `Details` disclosure sits below the reader message. Invalid specs use `role="alert"`. Equal errors are grouped by code and suggestion, with a count. Paths, values and fix patches use monospace. Raw schemas stay in a second closed disclosure.

Provider strings `refusalMessage`, `refusalHint`, `emptyMessage`, `emptyHint`, `failureMessage`, `failureHint` and `diagnosticDetails` set the wording. English and German defaults are available. These keys belong to the React provider, not `options.strings`. Legacy `{width}` and `{height}` templates appear only in full diagnostics. The reader heading uses plain default wording when such a template is supplied. `onRefused`, `onEmpty` and `renderRefused` keep their existing host contracts.

In code, `refused` on a layout from `layoutResolvedRequest` marks a size refusal only. A layout whose own lints carry severity `error` is refused too: render answers it with those errors and the components draw the error card. `isRefused(layout)` from `boardplot` is true in both cases; `measure` reports both in `refused`, without `geometry`. The second argument of `measure(request, context)` takes only `theme`, `locale` and `strings`; any other key is ignored with the warning `unknown-context-key`, and a width or height belongs in `options.size`.

### Design advice

Bar, line and waterfall have a design card: what the chart says, when to use it and when not, and four to eight rules. `boardplot_describe` prints the message, the use, the not-when and the first two rules; `path: "design"` (CLI: `boardplot describe bar --path design`) prints every rule. Each rule is marked `engine` or `describe`. Render checks the `engine` rules on the drawn chart and returns each finding as a warning with severity `advice`, a code that starts with `design-`, one sentence and a `docs` link to the rule. A `fix` patch is included only when it can apply to the input as sent. Otherwise follow `suggest`; for example, a waterfall built from rows gets written advice when a patch would target generated items. Advice never changes the drawing and never refuses. A render returns at most three, the MCP server returns each code once per session, and a refused render returns none. The `describe` rules need the author's judgment, such as the business order of a bridge.

## Named reference bands on a line

Use `options.referenceBands` on a line when the reader judges one long series against a few fixed regimes, such as the strong, typical and down cycles of a growth rate. Each band is one level (`value`) or a range (`low`, `high`) in the value-axis units, drawn thin and neutral behind the line. Its bold `label` and plain `description` stand in a column right of the plot, and an elbow leader ties a name to its band where the names had to spread apart. For the number at a point, a callout with `"headline": "${value}"` prints the value from the data in bold over its text, and `"arrow": true` points at the point.

```json
{
  "type": "line",
  "data": {
    "categories": ["2019", "2020", "2021", "2022", "2023", "2024", "2025", "2026"],
    "series": [{ "id": "growth", "label": "Sensor-module sales growth", "values": [-11, 7, 26, 3, -8, 19, 45, 52] }]
  },
  "options": {
    "title": "Sensor-module growth left the typical cycle in 2025",
    "subtitle": { "measure": "Year-over-year sensor-module sales growth" },
    "unit": "%",
    "referenceBands": [
      { "value": 45, "label": "45+", "description": "strong cycle" },
      { "low": 20, "high": 25, "label": "20 to 25", "description": "typical cycle" },
      { "low": -10, "high": -5, "label": "−5 to −10", "description": "modest down cycle" }
    ]
  }
}
```

Common mistakes:

- Overlapping bands. Two bands that share a span leave a value in it with two names; the render warns `reference-band-overlap`.
- Too many bands. Three or four read; more than six is refused, because the reader stops matching names to bands.
- A label that repeats the axis. "45" alone says what the tick already says; the description says what the level means ("strong cycle"). A band named only by numbers warns `reference-band-unexplained`.
- A plan corridor or a target drawn as a reference band. Those are a `band` annotation with `style: "corridor"` or a `valueLine`, which print their bounds.

The line reference has the full recipe under "Cycle bands", and the fixture `cycle-bands` draws 583 monthly points this way.

For a `valueLine` with `value: "mean"`, `seriesId` selects the series. A paired `from` and `to` selects the inclusive category window. The mean line spans only that window. Adjacent shaded `band` annotations have a hairline between them, so each period remains distinct.

## Times and numbers on the x axis of a line

A line or area draws `data.categories` as evenly spaced names by default. For readings at real times, or along a measured distance, give `data.x` and `options.xAxis` instead. The chart then places each reading by its value, so 7 minutes and 55 minutes keep their spacing, and it draws its own ticks: 1, 5, 15 and 30 minutes up to hours, days, weeks, months, quarters and years for times, and 1-2-5 steps for numbers. `series[].values` give one value per x, in the order of `data.x`, with `null` for a missing reading.

```json
{
  "type": "line",
  "data": {
    "x": ["2026-10-25T01:00", "2026-10-25T02:30", "2026-10-25T02:30", "2026-10-25T03:10", "2026-10-25T05:00"],
    "series": [{ "id": "hall", "label": "Hall", "values": [20.4, 20.1, 19.9, 19.8, 20.6] }]
  },
  "options": {
    "title": "The hall cooled through the extra hour",
    "unit": "°C",
    "xAxis": { "type": "time", "zone": "Europe/Berlin" }
  }
}
```

- `type` is `"time"` or `"number"`. A time is an ISO date-time; without an offset it is a wall time in `zone` (an IANA name, default `"UTC"`). A time with an offset, such as `Z` or `+01:00`, names its instant, and `zone` sets only the labels.
- When the clocks go back, a wall time occurs twice. The second reading of a repeated time counts as the later instant only when the order of the readings proves it, as above. Otherwise the render refuses `x-time-ambiguous`; give the offset. A wall time the change skips refuses `x-time-skipped`. The chart notes the zone and its offsets under it.
- `min` and `max` set the range. `tickStep` (`{ "unit": "hour", "step": 6 }`, or a number) or `ticks` (values, or `{ "value", "label" }`) set the ticks; `maxTicks` caps the automatic ones. `format` takes a time pattern such as `"HH:mm"` or a number example such as `"1.5"`. `title` and, on a number axis, `unit` name the axis.
- Automatic ticks never use hours for readings that all sit at midnight in `zone`. Whole-month readings start at month ticks, and whole-year readings start at year ticks. Crowded ticks use coarser steps. This also applies to zoom views and buckets. Authored `tickStep` or `ticks` wins.
- Events and bands stand at any x. A value line, a delta, a callout or a target names the x of a reading. A trend fits on elapsed time and prints its slope per second, minute, hour, day or week, or per `unit` on a number axis.
- On a time axis, `data.x` and every annotation x anchor accept epoch milliseconds. This includes `at`, `from`, `to`, object `categoryId`, and event `date` and `end`. An epoch value names an instant; the zone sets its labels. For example, `1772496000000` is `2026-03-03T00:00:00Z`. A numeric `delta.vs` stays a comparison value. Use `vs: { categoryId: 1772496000000 }` to compare with that reading.
- A `cagr` annotation on a time axis draws the same bracket and label as on a category axis. Its `from` and `to` name the x of two readings (default: the first and the last). The rate counts the exact years between the two readings on the calendar of `zone`: the whole years to the last anniversary, plus the rest as a share of the year after it, in milliseconds. So 1 January 2020 to 1 January 2025 is 5 years, and 1 January to 2 July 12:00 of 2025 is 0.5. An anniversary keeps the start's wall time, and 29 February falls on 28 February in a common year. A start value at or below zero omits the rate and warns `cagr-undefined`, as on a category axis. A number axis has no years, so a CAGR there warns `x-cagr-unsupported` and is not drawn.
- Not with `variant: "bump"` or `categoryAxis`.

The fixtures `x-time-daily`, `x-time-berlin-dst`, `x-time-uneven-sensors` and `x-number-trail` show the forms.

## Themes

A theme sets colours, type sizes, spacing and the scenario patterns. The presets are `boardroom` (the default), `standard`, `standard-dark`, `notation`, `notation-dark`, `capital`, `studio` and `glass`.

The `notation` preset follows the IBCS® Standards; IBCS is a registered trademark of the IBCS Institute, and the standards are published under CC BY-SA 4.0 at [www.ibcs.com](https://www.ibcs.com).

A brand theme is a preset plus overrides:

```json
{
  "type": "column",
  "data": { "categories": ["2024", "2025"], "series": [{ "id": "revenue", "values": [120, 135] }] },
  "theme": { "preset": "standard", "overrides": { "color": { "highlight": "#0B5CAD", "series": ["#0B5CAD", "#5B8DB8", "#A9C1D9"] } } }
}
```

The target replaces the type sizes of a preset; a size that `overrides` names still wins. A full theme registered under its own `name` keeps its sizes; `typeForTarget(theme.type, target)` from `boardplot/theme` rebuilds them for a target and keeps families, weights and line heights.

A theme key that Boardplot removed is refused with `invalid-theme-override` or `invalid-theme`, a suggest and a patch that removes it. `type.eyebrow.case` is removed: KPI eyebrows and waffle panel labels print names as written, so write capitals in the name to keep them. If the theme widened `type.eyebrow.tracking` for capitals, set `type.eyebrow.tracking` back or remove it. Absent means no letter-spacing, and a name in mixed case reads too wide with capital tracking.

An override can give `color.series` one or two colours. These colours come first. The remaining slots come from the preset, with colours that repeat an authored colour skipped. An override with three or more colours keeps its own ramp and overflow policy. A full theme needs at least one colour. It draws a two-series chart in exactly its two colours, and series past the end of its ramp follow `color.seriesOverflow`.

### Design system colours

Colour fields accept hex, the supported colour keywords, `rgb()` / `rgba()`, `hsl()` / `hsla()` and `oklch()`. For example, `oklch(65% 0.15 270)` becomes `#6c88ea`. Space-separated functions accept `/ alpha`, as in `hsl(210 50% 40% / 50%)`. Hue accepts degrees, `deg`, `grad`, `rad` and `turn`. OKLCH lightness accepts a number or percent; 100% chroma means 0.4. Missing components (`none`) become zero. Relative colours, `calc()`, `color-mix()` and other colour spaces are not supported. Use their computed literal colour instead.

Boardplot converts new colour forms to 8-bit sRGB before drawing. It clips each linear RGB channel to 0–1, applies the sRGB transfer function, then rounds each channel to the nearest byte. Alpha is kept. This is a fixed channel clip, so a colour outside sRGB can differ from a browser's gamut mapping. Contrast checks use the same bytes that the SVG draws. Existing hex and comma-separated RGB spellings keep their output bytes.

`var(--brand, #1f4e79)` is accepted with a required colour fallback. **Boardplot always draws the fallback.** It does not read the page variable, and it warns `css-var-fallback-used` once per variable: the warning names the variable, the colour it painted and the repair below. The fallback can itself be `oklch()` or `hsl()`. Bare `var(--brand)`, `currentColor` and an invalid fallback are refused with a fix. This rule is the same in React, SVG, PNG, CLI and MCP. It prevents a page variable from changing the fill while the label keeps ink chosen for another fill.

When the page changes a variable later, the chart does not change. For a page theme switch, pass new literal token values in the same update as the preset:

```tsx
import { BoardplotTheme } from 'boardplot/react/theme';
import { ColumnChart } from 'boardplot/react/column';

export function BrandChart({ dark = false }) {
  const theme = {
    preset: dark ? 'standard-dark' : 'boardroom',
    overrides: { color: { series: [dark ? '#8cbcff' : '#1f4e79'] } },
  };
  return <BoardplotTheme theme={theme}>
    <ColumnChart data={{ categories: [{ id: 'a' }], series: [{ id: 'core', values: [42] }] }} />
  </BoardplotTheme>;
}
```

Keep shared design tokens in application data when possible. If CSS owns the tokens, read `getComputedStyle(element).getPropertyValue('--brand').trim()` after the page has applied its theme. Pass that literal value as the override and repeat the read on each page theme switch. Choose the element that contains the chart, since variables can differ by page section. The host owns this update. Boardplot adds no DOM observer and reads no page state during server rendering.

### Stable series colours

Assign `colorRole` from one map keyed by series id before filtering or rendering. Use the same map for every chart and export. A `series-N` role always selects step N of `color.series`, with N starting at 1. It does not select a step of `options.palette`. An explicit `fill` still wins over `colorRole`.

```ts
const series = [{ id: 'core', values: [42] }, { id: 'extra', values: [18] }];
const selectedIds = new Set(['extra']);
const roleById = { core: 'series-1', extra: 'series-3', other: 'others' } as const;
const colouredSeries = series.map(s => ({
  ...s,
  colorRole: roleById[s.id as keyof typeof roleById],
}));
const visibleSeries = colouredSeries.filter(s => selectedIds.has(s.id));
```

Map every id whose colour must stay fixed. Unmapped series keep the automatic order-based colours. The map is application data; no provider state or new Boardplot option is needed. Roles follow the active theme, so a light-to-dark theme change keeps the series' rank while the theme chooses its colour. Use a shared map to `fill` instead when each id must keep an exact literal colour, and check that colour on both page themes.

If the ramp runs out, Boardplot keeps its repeat policy and warns. `series-colour-repeated` names each group that shares a colour. `series-indistinguishable` names keys with the same colour and shape. Group the tail into an “Other” series only when the values add. Otherwise use small multiples, or supply more distinct colours and assign them with `colorRole` or `fill`. Changing `seriesOverflow` to `cycle` still repeats colours. Boardroom's eight colours and their order stay unchanged.

Render checks colour roles present in the chart layout. `validateTheme(theme)` from `boardplot/validate` checks the full theme. Colour findings name the measured colours, vision mode and floor; contrast ratios round down to two decimals.

A full token object with its own `name` works too. `boardplot_describe` with type `theme` lists every token with its type and default.

In code, `registerTheme` makes a full token object available under its `name` to every chart, and `resolveTheme` returns a theme resolved and frozen, from a name or from `{ preset, overrides }`. Import both from `boardplot/theme`: it links no chart engine. The package root exports them too, but it registers the whole catalogue, so a host that draws through `boardplot/react/<type>` would carry every engine in its main bundle.

Layout measures text with bundled width tables for Geist, Helvetica and Arial, taking the first family of the stack that has one. Helvetica Neue is measured with the Helvetica widths (Liberation Sans), because no free Helvetica Neue font exists; for exact Helvetica Neue widths, build tables with `boardplot fonts build` ([FONTS.md](FONTS.md)). Inter has no table: the capital and glass presets lead with Inter and are measured as Helvetica Neue, the next family in their stack, so on a machine with Inter installed their text draws a little wider than measured. A leading family outside these, Inter and the metric clones Arimo, Liberation Sans and Nimbus Sans returns the warning `family-outside-metric-class`, a licensed brand font included; `boardplot fonts build <font-dir>` writes the tables for a licensed font ([FONTS.md](FONTS.md)). Boardplot rejects a theme for low contrast (`contrast-ink` below 4.5:1, `contrast-ink-muted` below 3:1), an unsupported colour (`unparseable-color`; see [Design system colours](#design-system-colours)), good and bad colours that look alike (`good-bad-similar`) or an unknown token (`invalid-theme`). These errors carry the path `/theme`.

## Where the reference is

- [reference/&lt;type&gt;.md](reference/waterfall.md): one page per chart type with use cases, chart IDs, minimal spec, data, options, annotations, sizing and fixtures.
- [reference/options.md](reference/options.md): the options every type shares, the value cell and annotation anchors.
- [reference/theme.md](reference/theme.md): presets, every token and the theme errors.
- [reference/react.md](reference/react.md): `BoardplotChart`, the per-type components, container sizing, server preparation and export.
- [reference/fixtures.md](reference/fixtures.md): every fixture by type.
- [FONTS.md](FONTS.md): width tables for a licensed font.
