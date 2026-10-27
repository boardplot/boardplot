"""The installed wheel works outside the repository checkout."""

from __future__ import annotations

import fnmatch
import os
import zipfile
from pathlib import Path

import pytest

import boardplot as bp

SOURCE = Path(__file__).resolve().parents[1] / "src"


# A wheel that works only in the development checkout, misses its engine or browser assets or the
# licence notices of the code compiled into them, or grows past the hard size limit.
def test_installed_wheel_has_assets_and_draws():
    wheel = os.environ.get("BOARDPLOT_WHEEL")
    if not wheel:
        pytest.skip("set BOARDPLOT_WHEEL to the built wheel and install it into this environment")
    assert os.path.getsize(wheel) <= 10 * 1024 * 1024
    archive = zipfile.ZipFile(wheel)
    names = set(archive.namelist())
    for name in ("boardplot/_assets/engine.js", "boardplot/_assets/runtime.js", "boardplot/_assets/widget.js",
                 "boardplot/_assets/build.json", "boardplot/_version.py",
                 "boardplot/_assets/licenses/LICENSE", "boardplot/_assets/licenses/NOTICE.md",
                 "boardplot/_assets/licenses/THIRD_PARTY_NOTICES.md", "boardplot/pyproject.toml"):
        assert name in names, name
    assert len(fnmatch.filter(names, "boardplot/_assets/streamlit/boardplot-*.js")) == 1, "the Streamlit bundle"
    notices = archive.read("boardplot/_assets/licenses/THIRD_PARTY_NOTICES.md").decode("utf-8")
    for package in ("## react ", "## react-dom ", "## zod ", "## Font width tables"):
        assert package in notices, package
    assert SOURCE not in Path(bp.__file__).resolve().parents, "boardplot is imported from the source tree, not the wheel"
    chart = bp.chart([{"region": "North", "revenue": 42.0}, {"region": "South", "revenue": 35.5}], "bar",
                     category="region", value="revenue", title="North leads")
    assert chart.svg.startswith("<svg")
