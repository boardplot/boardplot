"""The notebook widget: its mime bundle, the shared runtime and click delivery.

The browser side (hover, keyboard, theme, status) is checked by hand in each
host; these tests cover what Python decides.
"""

from __future__ import annotations

import pytest

pytest.importorskip("anywidget")

from boardplot import _widget  # noqa: E402

WIDGET_MIME = "application/vnd.jupyter.widget-view+json"


class StandIn:
    """The three attributes a Chart gives the widget module."""

    def __init__(self, title: str = "East leads revenue") -> None:
        self.spec = {
            "type": "column",
            "data": {
                "categories": [{"id": "n", "label": "North"}, {"id": "s", "label": "South"}],
                "series": [{"id": "revenue", "name": "revenue", "values": [42.0, 35.5]}],
            },
            "options": {"title": title},
        }
        self.svg = '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"></svg>'

    def _summary(self) -> str:
        return "<boardplot.Chart column 720x330>"


def _click(widget: _widget.BoardplotWidget, seq: int, revision: int) -> None:
    record = {"id": "n|revenue", "label": "North", "value": {"raw": 42.0}}
    # The custom message the browser sends for each click.
    widget._handle_custom_msg({"type": "event", "seq": seq, "revision": revision, "kind": "record", "record": record}, [])


# Prevents an output that a notebook front end cannot show as an interactive chart.
def test_bundle_holds_widget_view() -> None:
    chart = StandIn()
    bundle = _widget.widget_bundle(chart)
    assert bundle[WIDGET_MIME]["model_id"] == _widget.widget_for(chart).model_id
    assert _widget.widget_for(chart) is _widget.widget_for(chart)


# Prevents sending the multi-megabyte browser bundle to the page once per chart.
def test_two_charts_share_one_runtime() -> None:
    first = _widget.widget_for(StandIn("one"))
    second = _widget.widget_for(StandIn("two"))
    assert first is not second
    assert first.runtime is second.runtime
    assert len(first._esm) < 20_000


# Prevents a click on a chart's old drawing from reaching Python after the spec changed, and repeated clicks from being merged.
def test_stale_clicks_are_dropped_and_repeats_delivered() -> None:
    widget = _widget.widget_for(StandIn())
    seen: list[dict] = []
    widget.on_click(seen.append)
    old = widget.revision
    widget.spec = {**widget.spec, "options": {"title": "New title"}}
    _click(widget, 1, old)
    assert seen == []
    _click(widget, 2, widget.revision)
    _click(widget, 3, widget.revision)
    assert len(seen) == 2
