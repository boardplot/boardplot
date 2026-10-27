"""The Chart object: errors, refusals, themes and display."""

from __future__ import annotations

import json
import os
import subprocess
import sys
import warnings

import pytest

import boardplot as bp

ROWS = [{"region": "North", "revenue": 42.0}, {"region": "South", "revenue": 35.5}, {"region": "East", "revenue": 51.2}]
COLUMN = {"type": "column", "data": {"categories": ["Q1", "Q2", "Q3"], "series": [{"id": "revenue", "values": [84, 91, 97]}]},
          "options": {"title": "Revenue grows every quarter"}}


# An agent gets an opaque error it cannot repair.
def test_bad_spec_raises_spec_error_with_code_path_and_suggest():
    bad = {"type": "column", "data": {"categories": ["Q1"], "series": [{"id": "s", "values": ["many"]}]}}
    with pytest.raises(bp.SpecError) as caught:
        bp.Chart.from_spec(bad)
    error = caught.value
    assert error.code == "invalid-data"
    assert error.path == "/data/series/0/values/0"
    assert error.suggest
    assert "\nSuggest: " in str(error)


# A role the chart type does not take must fail in Python with the roles it does take.
def test_wrong_role_raises_input_error():
    with pytest.raises(bp.InputError) as caught:
        bp.chart(ROWS, "bar", x="region", y="revenue")
    assert "category=" in str(caught.value) and "value=" in str(caught.value)


# A chart that does not fit its own size must still be created, from a DataFrame too, not refused as invalid.
def test_size_refusal_gives_a_chart_with_a_warning():
    with pytest.warns(bp.BoardplotWarning, match="size-below-floor"):
        chart = bp.chart(ROWS, "column", category="region", value="revenue",
                         options={"title": "East leads", "size": {"width": 160, "height": 100}})
    assert chart.size == (280, 180)
    assert chart.svg.startswith("<svg")
    assert chart.spec["data"]["categories"]
    with pytest.raises(bp.RefusalError) as caught:
        chart.to_svg(width=120, height=80)
    assert caught.value.minimum == (280, 180)


def _full_theme(cli, tmp_path, name):
    """A preset resolved to its full theme object, by the engine source in the repository."""
    from conftest import ROOT

    script = tmp_path / "theme.mts"
    module = (ROOT / "src/core/theme.ts").as_uri()
    script.write_text(f"import {{ resolveTheme }} from {json.dumps(module)};\nconsole.log(JSON.stringify(resolveTheme({json.dumps(name)})));\n", encoding="utf-8")
    done = subprocess.run([cli.npx, "tsx", str(script)], cwd=ROOT, capture_output=True, text=True, encoding="utf-8", check=True)
    return json.loads(done.stdout)


# An explicit theme= must win over a theme the spec already carries, for a preset name and a full theme object.
def test_explicit_theme_wins(cli, tmp_path):
    conflicting = {**COLUMN, "options": {**COLUMN["options"], "theme": "notation"}}
    plain = bp.Chart.from_spec({**COLUMN, "theme": "standard-dark"})
    by_name = bp.chart([{"q": c, "v": v} for c, v in zip(["Q1", "Q2", "Q3"], [84, 91, 97])], "column",
                       category="q", value="v", template=conflicting, theme="standard-dark")
    assert by_name.theme == "standard-dark"
    assert "theme" not in by_name.spec["options"]
    full = _full_theme(cli, tmp_path, "standard-dark")
    assert bp.Chart.from_spec(conflicting).theme == "notation"
    over = bp.chart([{"q": c, "v": v} for c, v in zip(["Q1", "Q2", "Q3"], [84, 91, 97])], "column",
                    category="q", value="v", template=conflicting, theme=full)
    assert over.theme == full
    assert over.svg == by_name.svg
    assert over.svg != bp.chart([{"q": c, "v": v} for c, v in zip(["Q1", "Q2", "Q3"], [84, 91, 97])], "column",
                                category="q", value="v", template=conflicting).svg
    themed = bp.Chart.from_spec({**COLUMN, "theme": full})
    assert themed.svg == plain.svg


# Static renderers show nothing, or headless runs save broken widget outputs.
def test_static_display_has_svg_and_text_only():
    bp.set_display("static")
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            chart = bp.Chart.from_spec(COLUMN)
        bundle = chart._repr_mimebundle_()
        assert set(bundle) == {"image/svg+xml", "text/plain"}
        assert bundle["image/svg+xml"] == chart.svg
        assert bundle["text/plain"].startswith("<boardplot.Chart column")
    finally:
        bp.set_display("auto")


# A year column (integers) as category or series, or a pandas month column as date, was refused by the engine.
def test_number_ids_and_month_dates_draw():
    years = [{"m": "Jan", "y": 2024, "v": 1.0}, {"m": "Feb", "y": 2024, "v": 2.0},
             {"m": "Jan", "y": 2025, "v": 1.5}, {"m": "Feb", "y": 2025, "v": 2.5}]
    chart = bp.chart(years, "line", category="m", series="y", value="v", title="2025 runs ahead of 2024")
    assert [s["id"] for s in chart.spec["data"]["series"]] == ["2024", "2025"]
    import pandas as pd

    months = pd.DataFrame({"month": pd.date_range("2024-01-01", periods=3, freq="MS"), "revenue": [1.0, 2.0, 3.0]})
    chart = bp.chart(months, "line", category="month", date="month", value="revenue", title="Revenue grows every month")
    assert chart.spec["data"]["categories"][0]["date"] == "2024-01-01"


# A worker forked after the first chart (multiprocessing's default on Linux before Python 3.14) hangs
# in V8, on its next chart or at its normal exit, instead of failing.
@pytest.mark.skipif(not hasattr(os, "fork"), reason="this platform has no fork")
def test_forked_child_fails_fast_and_exits():
    script = """
import os, sys, time, signal, warnings
import boardplot as bp
rows = [{"region": "North", "revenue": 42.0}, {"region": "South", "revenue": 35.5}]
bp.chart(rows, "bar", category="region", value="revenue", title="North leads revenue")
warnings.simplefilter("ignore", DeprecationWarning)  # fork() of a process that runs threads
pid = os.fork()
if pid == 0:
    try:
        bp.chart(rows, "bar", category="region", value="revenue", title="North leads revenue")
        print("child: drawn", flush=True)
    except bp.EngineUnavailableError as error:
        print("child:", error.code, flush=True)
    sys.exit(0)  # a normal exit, with interpreter shutdown
deadline = time.monotonic() + 30
while True:
    done, status = os.waitpid(pid, os.WNOHANG)
    if done:
        print("parent: child exit", os.waitstatus_to_exitcode(status), flush=True)
        break
    if time.monotonic() > deadline:
        os.kill(pid, signal.SIGKILL)
        os.waitpid(pid, 0)
        print("parent: child hung", flush=True)
        break
    time.sleep(0.05)
"""
    result = subprocess.run([sys.executable, "-c", script], capture_output=True, text=True, timeout=120)
    assert "child: engine-forked" in result.stdout, result.stdout + result.stderr
    assert "parent: child exit 0" in result.stdout, result.stdout + result.stderr


# A numpy scalar, NaN or a byte order mark in a spec escaped as a bare TypeError, ValueError or OSError with no path.
def test_spec_values_are_json_ready_or_refused_with_their_path():
    import numpy as np

    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        spec = {**COLUMN, "data": {**COLUMN["data"], "series": [{"id": "revenue", "values": [np.int64(84), np.float64(91.5), 97]}]}}
        assert bp.Chart.from_spec(spec).spec["data"]["series"][0]["values"][:2] == [84, 91.5]
        assert bp.Chart.from_spec("\ufeff" + json.dumps(COLUMN)).svg.startswith("<svg")
    nan = {**COLUMN, "data": {**COLUMN["data"], "series": [{"id": "revenue", "values": [84, float("nan"), 97]}]}}
    with pytest.raises(bp.InputError) as caught:
        bp.Chart.from_spec(nan)
    assert caught.value.path == "/data/series/0/values/1" and caught.value.suggest


# A caller that catches RefusalError for sizes the engine refuses missed a size below 100 px, which raised SpecError.
def test_size_below_the_engine_floor_raises_refusal_error_with_the_minimum():
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        chart = bp.Chart.from_spec(COLUMN)
    with pytest.raises(bp.RefusalError) as caught:
        chart.to_svg(width=40, height=40)
    assert caught.value.minimum == (280, 180)


# A non-callable click handler was accepted and failed only when a reader clicked.
def test_on_click_refuses_a_value_that_cannot_be_called():
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        chart = bp.Chart.from_spec(COLUMN)
    with pytest.raises(bp.InputError):
        chart.on_click("not callable")


# theme=42 was reported as "unknown theme 'undefined'", a value the caller never passed.
def test_theme_of_the_wrong_type_names_the_argument():
    with pytest.raises(bp.InputError) as caught:
        bp.chart(ROWS, "bar", category="region", value="revenue", title="East leads revenue", theme=42)
    assert caught.value.path == "/theme" and "42" in str(caught.value)


# Changing a warning from chart.warnings changed the warnings of a Chart documented as immutable.
def test_warnings_are_copies():
    rows = [{"c": c, "v": v} for c, v in [("Elm", 18), ("Aster", 34), ("Birch", 11), ("Dune", 25), ("Cedar", 12)]]
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        chart = bp.chart(rows, "bar", category="c", value="v", title="Aster has the largest share")
    chart.warnings[0].code = "changed"
    assert chart.warnings[0].code != "changed"


# A Python caller was told to call boardplot_list, an MCP tool that Python does not have.
def test_suggestions_name_the_python_discovery_call():
    with pytest.raises(bp.SpecError) as caught:
        bp.chart(ROWS, "nonsense", category="region", value="revenue")
    assert "bp.list_charts()" in caught.value.suggest and "boardplot_list" not in caught.value.suggest


# A numpy longdouble converts to another numpy scalar, and the spec check recursed until RecursionError.
def test_numpy_scalar_without_a_python_value_is_refused_with_its_path():
    import numpy as np

    spec = {**COLUMN, "data": {**COLUMN["data"], "series": [{"id": "revenue", "values": [84, np.longdouble("91.5"), 97]}]}}
    with pytest.raises(bp.InputError) as caught:
        bp.Chart.from_spec(spec)
    assert caught.value.path == "/data/series/0/values/1"


# A one-chart document drawn below the size floor raised SpecError, while a bare chart raised RefusalError.
def test_document_below_the_size_floor_raises_refusal_error():
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        chart = bp.Chart.from_spec({"version": 1, "charts": [{**COLUMN, "name": "revenue"}]})
    with pytest.raises(bp.RefusalError) as caught:
        chart.to_svg(width=40, height=40)
    assert caught.value.minimum == (280, 180)


# The height floor (24 px) was taken as 100 px, so a sparkline 10 px high named a minimum taller than it needs.
def test_height_below_the_floor_names_the_real_minimum():
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        chart = bp.Chart.from_spec({"type": "sparkline", "data": bp.describe("sparkline")["example"]["data"]})
    with pytest.raises(bp.RefusalError) as caught:
        chart.to_svg(width=176, height=10)
    assert caught.value.minimum == (176, 24)


# A chart redrawn at its minimum size lost the states its rows carried (reading["data"]).
def test_size_retry_keeps_the_rows_reading():
    rows = [{"c": "A", "v": 10}, {"c": "B", "v": None, "st": "suppressed"}]
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        chart = bp.chart(rows, "column", category="c", value="v", state="st", title="B has no published value",
                         options={"size": {"width": 100, "height": 100}})
    assert chart.size == (280, 180)
    assert chart.reading["data"]["states"][0]["state"] == "suppressed"


# The tool-name rewrite also changed the caller's own quoted input, so the error misquoted it.
def test_tool_name_rewrite_keeps_quoted_input():
    with pytest.raises(bp.SpecError) as caught:
        bp.chart(ROWS, "boardplot_list", category="region", value="revenue")
    assert "'boardplot_list'" in caught.value.message and caught.value.suggest.startswith("Call bp.list_charts()")
