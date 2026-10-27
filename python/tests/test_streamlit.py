"""bp.st_chart: the Streamlit component."""

from __future__ import annotations

import fnmatch
import json
import subprocess
import sys
import textwrap
from pathlib import Path

import pytest

import boardplot as bp

EXAMPLES = Path(__file__).resolve().parents[1] / "examples"
ROWS = [{"region": "North", "revenue": 42.0}, {"region": "South", "revenue": 35.5},
        {"region": "East", "revenue": 51.2}, {"region": "West", "revenue": 28.9}]


# A packaging error (manifest, asset folder or bundle glob) leaves Streamlit apps blank, or the browser gets another spec than Python resolved.
def test_example_app_runs_and_sends_the_resolved_spec():
    pytest.importorskip("streamlit")
    from streamlit.testing.v1 import AppTest

    app = AppTest.from_file(str(EXAMPLES / "streamlit_app.py"), default_timeout=120)
    app.run()
    assert not app.exception, [e.value for e in app.exception]
    charts = app.get("bidi_component")
    assert len(charts) == 4
    first = charts[0].proto
    assert first.component_name == "boardplot.chart"
    assert fnmatch.fnmatch(first.js_source_path, "boardplot-*.js"), first.js_source_path
    data = json.loads(first.json)
    expected = bp.chart(ROWS, "bar", category="region", value="revenue", title="East leads revenue")
    assert data["spec"] == expected.spec
    assert data["clicks"] is True
    build = json.loads((Path(bp.__file__).parent / "_assets" / "build.json").read_text(encoding="utf-8"))
    assert data["identity"] == build["identity"]
    # The sidebar chart sends no clicks; the explicit theme travels in the spec.
    assert [json.loads(c.proto.json)["clicks"] for c in charts] == [True, True, False, False]
    assert json.loads(charts[2].proto.json)["spec"]["theme"] == "standard-dark"


# `import boardplot` breaks for every user without Streamlit, or bp.st_chart fails without saying how to install it.
def test_import_works_without_streamlit():
    code = textwrap.dedent("""
        import importlib.abc, sys

        class NoStreamlit(importlib.abc.MetaPathFinder):
            def find_spec(self, name, path=None, target=None):
                if name == "streamlit" or name.startswith("streamlit."):
                    raise ModuleNotFoundError(f"No module named {name!r}", name=name)
                return None

        sys.meta_path.insert(0, NoStreamlit())
        import boardplot as bp
        assert "streamlit" not in sys.modules
        assert "st_chart" in bp.__all__
        try:
            bp.st_chart([{"region": "North", "revenue": 1.0}], "bar", category="region", value="revenue")
        except ImportError as error:
            assert 'pip install "boardplot[streamlit]"' in str(error), str(error)
        else:
            raise AssertionError("st_chart ran without Streamlit")
    """)
    done = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True, encoding="utf-8")
    assert done.returncode == 0, done.stderr


# A function as on_click without key= would never get a click, because Streamlit keeps the record in Session State only under a key.
def test_callable_on_click_needs_a_key():
    with pytest.raises(bp.InputError) as caught:
        bp.st_chart(ROWS, "bar", category="region", value="revenue", on_click=lambda record: None)
    assert caught.value.code == "missing-key"


# Two identical charts without key= stopped the app with Streamlit's message about an internal "bidi_component", which names no call to fix.
def test_same_chart_twice_without_key_names_the_fix():
    pytest.importorskip("streamlit")
    from streamlit.testing.v1 import AppTest

    def app() -> None:
        import boardplot as bp

        rows = [{"region": "North", "revenue": 42.0}, {"region": "South", "revenue": 35.5}]
        bp.st_chart(rows, "bar", category="region", value="revenue", title="North leads")
        bp.st_chart(rows, "bar", category="region", value="revenue", title="North leads")

    run = AppTest.from_function(app, default_timeout=120)
    run.run()
    assert len(run.exception) == 1
    assert "key=" in run.exception[0].value and "same chart twice" in run.exception[0].value


# A clicking chart inside st.form never reran the script or called its function, because Streamlit drops click events in forms.
def test_clicks_inside_a_form_are_refused():
    pytest.importorskip("streamlit")
    from streamlit.testing.v1 import AppTest

    def app() -> None:
        import streamlit as st

        import boardplot as bp

        rows = [{"region": "North", "revenue": 42.0}, {"region": "South", "revenue": 35.5}]
        with st.form("filters"):
            bp.st_chart(rows, "bar", category="region", value="revenue", title="North leads", key="quiet")
            bp.st_chart(rows, "bar", category="region", value="revenue", title="North leads", key="rev", on_click="rerun")
            st.form_submit_button("Apply")

    run = AppTest.from_function(app, default_timeout=120)
    run.run()
    assert len(run.get("bidi_component")) == 1
    assert len(run.exception) == 1 and "st.form" in run.exception[0].value
