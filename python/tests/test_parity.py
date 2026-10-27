"""Python output against the Boardplot CLI, byte for byte."""

from __future__ import annotations

import json

import pytest

import boardplot as bp

from conftest import CI_TYPES


# A bundling, shim or polyfill change silently alters the SVG Python draws.
@pytest.mark.parametrize("type_name", CI_TYPES)
def test_fixture_svg_equals_cli(cli, tmp_path, type_name):
    fixture = cli.first_example(type_name)
    expected = cli.render(fixture["spec"], tmp_path)
    assert expected["ok"] is True, expected
    chart = bp.Chart.from_spec(fixture["spec"])
    assert chart.to_svg() == expected["svg"]


ROWS_CASES = {
    "category": (
        {"type": "bar", "options": {"title": "East leads revenue"}},
        [{"region": "North", "segment": "Retail", "revenue": 42.0}, {"region": "South", "segment": "Retail", "revenue": 35.5},
         {"region": "East", "segment": "Retail", "revenue": 51.2}, {"region": "North", "segment": "Online", "revenue": 12.0},
         {"region": "South", "segment": "Online", "revenue": 18.5}, {"region": "East", "segment": "Online", "revenue": 9.25}],
        {"category": "region", "series": "segment", "value": "revenue"},
    ),
    "map": (
        {"type": "choropleth", "data": {"pack": "de-states"}, "options": {"title": "Bavaria leads"}},
        [{"state": "DE-BY", "sales": 82.1}, {"state": "DE-BW", "sales": 68.4}, {"state": "DE-BE", "sales": 31.8}],
        {"category": "state", "value": "sales"},
    ),
    "waterfall": (
        {"type": "waterfall", "options": {"title": "Price drives EBIT"}},
        [{"step": "FY25", "delta": 142, "kind": "total"}, {"step": "Price", "delta": 38, "kind": "delta"},
         {"step": "Cost", "delta": -21, "kind": "delta"}, {"step": "FY26", "delta": 159, "kind": "total"}],
        {"label": "step", "value": "delta", "type": "kind"},
    ),
    "scatter": (
        {"type": "scatter", "options": {"title": "Quality rises with price"}},
        [{"price": 3.2, "quality": 2.1, "brand": "A"}, {"price": 4.2, "quality": 3.6, "brand": "B"}, {"price": 6.0, "quality": 4.4, "brand": "C"}],
        {"x": "price", "y": "quality", "label": "brand"},
    ),
}


# The Python rows path drifts from the CLI's `render --rows`.
@pytest.mark.parametrize("shape", sorted(ROWS_CASES))
def test_rows_equal_cli(cli, tmp_path, shape):
    template, rows, columns = ROWS_CASES[shape]
    rows_file = tmp_path / "rows.json"
    rows_file.write_text(json.dumps(rows), encoding="utf-8")
    mapping = ",".join(f"{role}={column}" for role, column in columns.items())
    expected = cli.render(template, tmp_path, "--rows", str(rows_file), "--columns", mapping)
    assert expected["ok"] is True, expected

    roles = {("item_type" if role == "type" else role): column for role, column in columns.items()}
    extra = {"pack": template["data"]["pack"]} if shape == "map" else {}
    chart = bp.chart(rows, template["type"], title=template["options"]["title"], **roles, **extra)
    assert chart.svg == expected["svg"]
    # The reading's rows record names its source (a file here, inline rows in Python), so it stays out.
    assert {k: v for k, v in chart.reading.items() if k != "data"} == {k: v for k, v in expected["reading"].items() if k != "data"}
    # The resolved spec alone draws the same chart.
    assert bp.Chart.from_spec(chart.spec).svg == expected["svg"]


# Python discovery drifts from what the CLI and MCP describe.
def test_describe_equals_cli(cli):
    assert bp.describe("column") == cli.run("describe", "column")
