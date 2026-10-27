# Boardplot for Python

Consulting-grade charts from a DataFrame. The package runs Boardplot's own JavaScript engine in embedded V8, so a chart drawn in Python has the same SVG bytes as `boardplot render` draws for the same spec. You do not need Node, npm or a browser.

## Install

```bash
pip install boardplot
```

The V8 engine comes from the `mini-racer` dependency. It has wheels for macOS, Linux (x86_64 and aarch64) and Windows (AMD64 and ARM64). On other platforms, such as Pyodide, JupyterLite, 32-bit Linux, ppc64le and s390x, the install still works, but every chart raises `EngineUnavailableError` with the reason.

## First chart in a notebook

```python
import boardplot as bp
import pandas as pd

df = pd.DataFrame({"region": ["North", "South", "East"], "revenue": [42.0, 35.5, 51.2]})
bp.chart(df, "bar", category="region", value="revenue", title="East leads revenue")
```

The cell shows the chart. A bar chart takes `category` and `value`. Without `series`, the chart gets one series named after the value column (here `revenue`).

## First chart in a script

```python
import boardplot as bp

rows = [
    {"month": "Jan", "region": "North", "revenue": 10.0},
    {"month": "Feb", "region": "North", "revenue": 12.5},
    {"month": "Jan", "region": "South", "revenue": 8.0},
    {"month": "Feb", "region": "South", "revenue": 9.5},
]
c = bp.chart(rows, "line", category="month", series="region", value="revenue",
             title="Revenue grows in both regions")
c.save("revenue.svg", overwrite=True)   # the same bytes as `boardplot render`
print(c)                                # <boardplot.Chart line 720×... · 2 series · warnings: none>
```

`data` is an eager DataFrame (pandas, polars, pyarrow, or another frame that [narwhals](https://narwhals-dev.github.io/narwhals/) reads) or a list of row dicts. For a lazy frame, collect it first.

## Column roles

Each role names a source column. The chart type sets the rows shape and its roles.

| Rows shape | Types | Required | Optional |
|---|---|---|---|
| category | bar, bartable, butterfly, column, combo, dot, funnel, heatmap, line, mekko, pie, slope, variance, waffle | `category`, `value` | `series`, `category_label`, `series_label`, `unit`, `date`, `state` |
| map | choropleth, tilemap | `category`, `value`, and `pack=` | `state` |
| waterfall | waterfall | `label`, `value` | `item_type` (delta, subtotal or total) |
| scatter | scatter | `x`, `y` | `size`, `label`, `group` |

Rules:

- `value_kind` is not a column. It is `"number"` (default), `"percent"` (50 means 50%) or `"fraction"` (0.5 means 50%).
- To get one series per column from a wide frame, pass `value=[...]`. Without `series`, the frame changes from wide to long. Row order stays the same:

  ```python
  import boardplot as bp
  import pandas as pd

  wide = pd.DataFrame({"quarter": ["Q1", "Q2", "Q3"], "revenue": [84, 91, 97], "cost": [61, 63, 64]})
  bp.chart(wide, "column", category="quarter", value=["revenue", "cost"], title="Revenue pulls away from cost")
  ```

- `butterfly` and `variance` also need options that name series ids. `butterfly` takes `options={"a": ..., "b": ...}`: the series in the left and the right pane. `variance` takes `options={"variant": ..., "variance": {"of": ..., "vs": ...}}`: the variant (`absolute`, `relative` or `integrated`), the series it measures and the reference series. A template gives the reference series `role: "reference"`.

  ```python
  import boardplot as bp

  rows = [{"region": r, "scenario": s, "revenue": v}
          for r, s, v in [("North", "plan", 100), ("North", "actual", 80), ("South", "plan", 90), ("South", "actual", 95)]]
  bp.chart(rows, "butterfly", category="region", series="scenario", value="revenue",
           title="North trails plan", options={"a": "plan", "b": "actual"})
  bp.chart(rows, "variance", category="region", series="scenario", value="revenue",
           title="North trails plan", options={"variant": "absolute", "variance": {"of": "actual", "vs": "plan"}},
           template={"data": {"series": [{"id": "plan", "role": "reference", "values": []}]}})
  ```

- `state` names a column with the reason a cell has no value: `na` (not available), `nm` (not meaningful) or `suppressed` (withheld). A row with a state needs an empty value. Leave the state empty for a row with a value. The drawn chart shows a cell with a state as a missing value. The states are kept in `c.reading["data"]["states"]` only.
- `x` and `y` are scatter roles only. A bar chart uses `category` and `value`.
- Python does not aggregate, sort or sample. It sends only the mapped columns to the engine.
- Numbers in `category`, `series`, `category_label`, `series_label`, `label` and `group` columns become text: the year 2024 becomes the id `"2024"`.
- A datetime column whose values are all midnight, without a time zone, arrives as dates (`2024-01-01`). Monthly or daily data then works with `date=` and prints as dates. Other datetimes arrive in ISO 8601 with their offset and full precision.
- Other chart types (table, histogram, box and the others) take a spec: `bp.Chart.from_spec(spec)`. A spec can be a dict, a JSON string or a `pathlib.Path` to a JSON file.

Other arguments: `options=` (the Boardplot spec options), `title=` (short for `options["title"]`), `annotations=`, `theme=`, `name=`, `pack=` (choropleth and tilemap) and `template=` (a partial spec whose labels, colours and formats the rows keep).

`annotations=` is a list of annotation dicts. Each one has a `kind`. Its other fields, and any anchors with ids from the chart, depend on the kind: `note` takes `at`, `diff` takes `from` and `to`, and `valueLine` takes a value instead of an anchor. `bp.describe("bar", path="annotations")` lists the kinds and their fields.

```python
import boardplot as bp

rows = [{"brand": "Aster", "share": 34}, {"brand": "Dune", "share": 25}, {"brand": "Elm", "share": 18}]
bp.chart(rows, "bar", category="brand", value="share", title="Aster leads the market",
         annotations=[{"kind": "note", "at": {"categoryId": "Aster", "seriesId": "share"}, "text": "Largest share"}])
```

A scatter chart does not name its axes or its size key from the column names. Name them in `options`:

```python
import boardplot as bp

products = [{"product": "A", "margin": 20, "growth": 5, "revenue": 100},
            {"product": "B", "margin": 35, "growth": 12, "revenue": 60},
            {"product": "C", "margin": 12, "growth": -3, "revenue": 140}]
bp.chart(products, "scatter", x="margin", y="growth", size="revenue", label="product", title="B grows fastest",
         options={"axisTitles": {"x": "Margin, %", "y": "Growth, %"}, "sizeLegend": {"label": "Revenue, €m"}})
```

A template gives labels, colours and formats to the categories and series whose ids match the rows. The series colour key is `fill`. The template's `values` are replaced by the rows:

```python
import boardplot as bp

template = {"data": {"categories": [{"id": "N", "label": "North"}, {"id": "S", "label": "South"}],
                     "series": [{"id": "revenue", "label": "Revenue", "fill": "#1f6f8b", "format": "1,234.0", "values": []}]},
            "options": {"unit": "EUR"}}
rows = [{"region": "N", "revenue": 1234.5}, {"region": "S", "revenue": 987.0}]
bp.chart(rows, "column", category="region", value="revenue", title="North sells more", template=template)
```

## The Chart object

```python
import boardplot as bp

c = bp.chart([{"q": "Q1", "v": 84}, {"q": "Q2", "v": 91}], "column", category="q", value="v", title="Q2 beats Q1")
c.spec        # the resolved Boardplot spec (a copy)
c.svg         # the static SVG, or None when the engine refused every size it tried
c.size        # (width, height) of the static SVG
c.warnings    # BoardplotWarning findings of the validation render
c.reading     # the engine's reading: counts, title, labels
c.to_svg(width=960)                    # draw again at another size
c2 = c.with_options(subtitle="EUR m")  # a new Chart; c does not change
```

A chart that does not fit its own size is still valid. Python draws the static SVG once more at the minimum size that the engine names, and gives a `BoardplotWarning`. If the engine names no minimum size, `c.svg` is `None`, `c.refusal` holds the reason, and `to_svg()` raises `RefusalError`. An explicit size in `to_svg(width=..., height=...)` that the engine refuses also raises `RefusalError`, with `error.minimum`.

## Errors and their fix

A wrong spec raises at once, with the engine's code, JSON path, message and suggestion:

```python
import boardplot as bp

bad = {"type": "column", "data": {"categories": ["Q1"], "series": [{"id": "revenue", "values": ["n/a"]}]}}
try:
    bp.Chart.from_spec(bad)
except bp.SpecError as error:
    print(error)
    print(error.code, error.path)
```

```text
invalid-data at /data/series/0/values/0: data.series.0.values.0: Invalid input: expected number | null | value-object, received string.
Suggest: Take the shape from the 'column' example and replace the values.
invalid-data /data/series/0/values/0
```

The fix: a missing value is `None` (JSON `null`), not text:

```python
import boardplot as bp

fixed = {"type": "column", "data": {"categories": ["Q1"], "series": [{"id": "revenue", "values": [None]}]},
         "options": {"title": "No Q1 figure yet"}}
bp.Chart.from_spec(fixed)
```

Error classes: `BoardplotError` is the base. `InputError` is for argument problems and for the DataFrame problems that Python finds: a missing column, a lazy frame, a cell without a JSON form. A spec value without a JSON form (NaN, infinity, an object) also raises `InputError`, with its path. `SpecError` is for specs the engine refuses. It is also for the row problems that the engine finds: a null category id, two rows for the same category and series, and an empty frame. For a problem in one row, `path` names the source row, for example `/rows/1/region`. For an empty frame, `path` is `/rows`. `RefusalError` is for sizes the engine refuses, and `EngineUnavailableError` means there is no V8 engine or the engine build does not match. Each error has `code`, `path`, `message`, `suggest`, `fix` and `details`.

## Discovery

`describe` and `list_charts` run the engine's own discovery code. They return what the MCP tools `boardplot_describe` and `boardplot_list` return.

```python
import boardplot as bp

catalog = bp.list_charts()                      # types, themes, shared options, limits
bar = bp.describe("bar")                        # the authoring contract of one type
axis = bp.describe("bar", path="valueAxis")     # one field and everything below it
schema = bp.describe("bar", schema="options")   # the JSON Schema of the options
tokens = bp.describe("theme")                   # the theme tokens
print([t["type"] for t in catalog["types"]][:5], bar["summary"])
```

## Interactive view

In a live notebook (JupyterLab, Notebook 7, VS Code, Colab), a chart shows as an interactive view. It draws at the width of the output area, shows a hover card for each mark, and takes the keyboard: Tab moves into the chart, the arrow keys move between marks, and Enter clicks. Without an explicit `theme=`, the view follows the notebook: `boardroom` on a light page, `standard-dark` on a dark one.

```python
import boardplot as bp
import pandas as pd

df = pd.DataFrame({"region": ["North", "South", "East"], "revenue": [42.0, 35.5, 51.2]})
c = bp.chart(df, "bar", category="region", value="revenue", title="East leads revenue")
clicks = []
c.on_click(clicks.append)   # every click on a mark adds Boardplot's record of it
c
```

In marimo, wrap the view so that other cells react to clicks:

```python
import marimo as mo

view = mo.ui.anywidget(c.widget())
view   # another cell reads view.value["selection"], the last clicked record
```

The browser bundle (3.8 MB) goes to the page once per kernel, not once per chart. Tables show no row clicks yet.

## Streamlit

```bash
pip install "boardplot[streamlit]"
```

```python
import boardplot as bp
import pandas as pd
import streamlit as st

df = pd.DataFrame({"region": ["North", "South", "East"], "revenue": [42.0, 35.5, 51.2]})
result = bp.st_chart(df, "bar", category="region", value="revenue", title="East leads revenue",
                     key="rev", on_click="rerun")
if result.click:
    st.write("You picked", result.click.get("categoryLabel"))
```

`bp.st_chart` takes a `Chart`, or data with the `bp.chart` arguments. The chart fills its container: the main column, a `st.columns` column or the sidebar. Every chart needs at least 280 px of width. Streamlit's default sidebar leaves about 240 px, so widen it with `st.set_page_config(initial_sidebar_state=360)`.

`on_click` sets what a click does:

| `on_click` | Effect |
|---|---|
| `"ignore"` (default) | Nothing goes to Python. A click never reruns the script. |
| `"rerun"` | Each click reruns the script. `result.click` holds the record in that run, `result.selection` the last record across runs. |
| a function | Streamlit calls it with the record before the rerun. It needs `key=`. |

Inside `st.form`, Streamlit drops click events, so a chart there takes only `on_click="ignore"`.

Without `theme=`, the chart follows the app theme, also when the reader switches it: `boardroom` on a light app, `standard-dark` on a dark one. An explicit `theme=` always wins. `python/examples/streamlit_app.py` is a complete app.

## Display modes

```python
import boardplot as bp

bp.set_display("static")   # "auto" (default), "widget" or "static"
```

- `static` shows the SVG (`image/svg+xml`) and a text line (`text/plain`).
- `widget` shows the interactive view. The same output also holds the SVG and the text.
- `auto` is a heuristic. It uses the widget when an IPython kernel runs and a live front end is likely: `JPY_SESSION_NAME` is set (Jupyter Server), a `VSCODE_*` variable is set, or `google.colab` is loaded. Otherwise it uses static.
- A kernel that a batch runner starts can inherit these variables. For papermill, nbclient and `jupyter nbconvert --execute`, set `BOARDPLOT_DISPLAY=static` in the environment, so that the saved notebook holds SVG charts.
- marimo calls `Chart._display_()`. In static mode this returns the SVG, otherwise the widget.

**Reopen limit:** a notebook that you reopen without a running kernel shows "Error displaying widget: model not found" for a widget output in JupyterLab and Notebook 7. These front ends do not fall back to the SVG. Run the cell again, or use `bp.set_display("static")` for notebooks that must show charts without a kernel.

**Exporting notebooks saved with widget outputs:** `jupyter nbconvert --to html` shows the widget view when the notebook has saved widget state. That view needs anywidget's code from a CDN, so offline it shows no chart. To export the SVG instead, put `image/svg+xml` first in the display priority:

```bash
jupyter nbconvert --to html notebook.ipynb \
  --NbConvertBase.display_data_priority="['image/svg+xml','application/vnd.jupyter.widget-view+json','application/javascript','text/html','text/markdown','text/latex','image/png','image/jpeg','text/plain']"
```

JupyterLab's "Save Widget State Automatically" setting is off by default. If you turn it on, the notebook also saves the 3.8 MB browser bundle of the widget.

## Themes and locale

```python
import boardplot as bp

rows = [{"q": "Q1", "v": 1234.5}, {"q": "Q2", "v": 1410.0}]
dark = bp.chart(rows, "column", category="q", value="v", title="Q2 is up", theme="standard-dark",
                options={"unit": "EUR"})
german = bp.chart(rows, "column", category="q", value="v", title="Q2 liegt vorn",
                  options={"unit": "EUR", "locale": {"language": "de-DE"}})
```

- `theme=` takes a preset name, `{"preset": ..., "overrides": {...}}` or a full theme object. It replaces every theme in the spec or template. `bp.describe("theme")` lists the tokens. `Chart.theme` returns the theme in force, or `None`.
- With no theme, the static SVG uses the engine default, `boardroom`.
- The package never sets a locale. It does not read the locale of the operating system, the browser or Python. Numbers keep Boardplot's default marks (1,234.5: comma groups, dot decimal) unless your options set them. `{"language": "de-DE"}` alone does not change the marks.

## Network and telemetry

- The package makes no network calls. It has no CDN import, no font download and no update check. All JavaScript ships in the wheel.
- The package has no telemetry. A telemetry setting of the Boardplot CLI does not apply to Python.
- Only the columns you map leave your DataFrame, and they go to the in-process engine as JSON data, never as code.
- Connections that the host makes (the Jupyter kernel, Colab, or the CDN that nbconvert's widget embedding uses) belong to the host.

## Settings

| Environment variable | Effect |
|---|---|
| `BOARDPLOT_DISPLAY` | Start value of the display mode: `auto`, `widget` or `static`. |
| `BOARDPLOT_ENGINE_TIMEOUT` | Seconds one engine call may run (default 60). |

## Development

From the repository root, with Node 22:

```bash
npm ci
node python/js/build.mjs                     # writes python/src/boardplot/_assets/ and _version.py
npx tsc -p python/js/tsconfig.json --noEmit
cd python && python -m build --wheel         # needs the assets; the build stops with a hint without them
pip install dist/boardplot-*.whl pytest pandas polars streamlit
pytest
```

`python python/scripts/parity_sweep.py` compares the Python engine with the CLI for every fixture. It is a manual sweep, not a test. Use `--types`, `--kind` and `--limit` for a short run.
