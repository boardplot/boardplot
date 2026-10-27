"""``bp.st_chart()``: a Boardplot chart in Streamlit.

The chart is a Streamlit Components v2 component. Its browser code is the
same mount as the notebook view, built as ``_assets/streamlit/boardplot-<hash>.js``.
The component manifest ``boardplot/pyproject.toml`` names that folder as the
component's ``asset_dir``, so Streamlit serves it over HTTP and the browser
caches it.

Streamlit is imported only when ``st_chart`` runs, so ``import boardplot``
works without it.
"""

from __future__ import annotations

import functools
import json
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from ._chart import Chart, _place_theme, chart
from ._errors import InputError

__all__ = ["ChartResult", "st_chart"]

COMPONENT = "boardplot.chart"
_JS = "boardplot-*.js"
_ASSETS = Path(__file__).parent / "_assets"
_INSTALL = 'pip install "boardplot[streamlit]"'

ClickCallback = Callable[[dict[str, Any]], Any]


@dataclass(frozen=True)
class ChartResult:
    """What ``st_chart`` returns.

    ``click`` is the record of the click that caused this script run, else None.
    ``selection`` is the last clicked record; it stays across reruns. Both are
    None until the first click, and always None with ``on_click="ignore"``.
    """

    click: dict[str, Any] | None = None
    selection: dict[str, Any] | None = None


def _streamlit() -> Any:
    try:
        import streamlit as st
        import streamlit.components.v2  # noqa: F401  (Components v2 came with Streamlit 1.51)
    except ModuleNotFoundError as error:
        if error.name is not None and error.name.split(".")[0] == "streamlit":
            raise ImportError(
                f"bp.st_chart needs Streamlit 1.59 or later. Install it with: {_INSTALL}"
            ) from None
        raise
    return st


@functools.cache
def _identity() -> dict[str, Any]:
    """The build identity the browser bundle must carry (``identity`` in ``_assets/build.json``)."""
    try:
        data = json.loads((_ASSETS / "build.json").read_text(encoding="utf-8"))
    except FileNotFoundError:
        data = {}
    identity = data.get("identity")
    if not isinstance(identity, dict) or not isinstance(identity.get("version"), str):
        msg = f"{_ASSETS / 'build.json'} has no build identity. A source checkout builds it with `node python/js/build.mjs`."
        raise RuntimeError(msg)
    return dict(identity)


def _check_bundle() -> None:
    found = sorted((_ASSETS / "streamlit").glob(_JS))
    if len(found) != 1:
        msg = (
            f"Boardplot's Streamlit bundle needs exactly one {_JS} in {_ASSETS / 'streamlit'}, found {len(found)}. "
            "A source checkout builds it with `node python/js/build.mjs`."
        )
        raise RuntimeError(msg)


def _renderer(st: Any) -> Any:
    """The component's mount command.

    Registered on every call: the definition is the same each time, so
    Streamlit logs nothing, and a new runtime (a restarted server, each
    AppTest) gets the definition too.
    """
    _check_bundle()
    try:
        return st.components.v2.component(COMPONENT, js=_JS)
    except Exception as error:
        if getattr(error, "error_id", None) == "component-missing-asset-dir":
            msg = (
                "Streamlit did not find Boardplot's component manifest (boardplot/pyproject.toml). "
                "It finds it only in an installed boardplot distribution: install the wheel, or "
                "`pip install -e python` in a source checkout."
            )
            raise RuntimeError(msg) from error
        raise


def _in_form(st: Any) -> bool:
    """Whether the call runs inside ``st.form``, where Streamlit drops a component's trigger values (clicks)."""
    try:
        from streamlit.elements.lib.form_utils import is_in_form

        return bool(is_in_form(st._main))
    except Exception:  # an internal module of Streamlit: without it, no check
        return False


def _noop() -> None:
    return None


def _run_callback(st: Any, key: str, callback: ClickCallback) -> None:
    """The zero-argument Streamlit callback: read the record from Session State and call the user's function."""
    value = st.session_state.get(key)
    if value is None:
        return
    record = value.get("click") if hasattr(value, "get") else None
    if not isinstance(record, dict):
        record = value.get("selection") if hasattr(value, "get") else None
    if isinstance(record, dict):
        callback(record)


def _with_theme(source: Chart, theme: Any) -> Chart:
    spec = source.spec
    _place_theme(spec, theme)
    return Chart.from_spec(spec)


def st_chart(
    chart_or_data: Any,
    type: str | None = None,
    *,
    key: str | None = None,
    on_click: str | ClickCallback = "ignore",
    theme: Any = None,
    **chart_kwargs: Any,
) -> ChartResult:
    """Draw a Boardplot chart in a Streamlit app, at the width of its container.

    ``chart_or_data`` is a ``Chart``, or a DataFrame (or list of row dicts) with
    the ``bp.chart`` arguments: ``st_chart(df, "bar", category="region", value="revenue")``.

    ``on_click``: ``"ignore"`` (default) sends nothing to Python, so a click
    never reruns the script. ``"rerun"`` reruns the script on each click;
    ``result.click`` holds the record in that run, ``result.selection`` the
    last record across runs. A function is called with the record before the
    rerun; it needs ``key=``.

    Without ``theme=`` the chart follows the app's light or dark theme, unless
    the spec names a theme. An explicit ``theme=`` always wins.
    """
    if not (on_click in ("ignore", "rerun") or callable(on_click)):
        raise InputError(
            f"on_click is 'ignore', 'rerun' or a function, not {on_click!r}",
            code="invalid-argument",
            suggest="Pass on_click='rerun' to read result.click, or a function that takes the record.",
        )
    if callable(on_click) and key is None:
        raise InputError(
            "a function as on_click needs key=",
            code="missing-key",
            suggest="Pass a stable key, such as key='revenue_chart': Streamlit keeps the clicked record in Session State under it.",
        )
    if key is not None and not isinstance(key, str):
        raise InputError(f"key is a string, not {key!r}", code="invalid-argument")

    st = _streamlit()

    if isinstance(chart_or_data, Chart):
        if type is not None or chart_kwargs:
            raise InputError(
                "pass a Chart alone, or data with the bp.chart arguments",
                code="invalid-argument",
                suggest="Use st_chart(c) for a Chart, or st_chart(df, 'bar', category=..., value=...) for data.",
            )
        drawn = chart_or_data if theme is None else _with_theme(chart_or_data, theme)
    else:
        drawn = chart(chart_or_data, "column" if type is None else type, theme=theme, **chart_kwargs)

    clicks = on_click != "ignore"
    if clicks and _in_form(st):
        raise InputError(
            "a chart inside st.form cannot send clicks: Streamlit drops click events in forms",
            code="clicks-in-form",
            suggest="Move the chart outside the form, or use on_click='ignore' inside it.",
        )
    data = {"spec": drawn.spec, "clicks": clicks, "hover": True, "identity": _identity()}
    callbacks: dict[str, Callable[[], None]] = {}
    if on_click == "rerun":
        callbacks = {"on_click_change": _noop, "on_selection_change": _noop}
    elif callable(on_click):
        callbacks = {
            "on_click_change": functools.partial(_run_callback, st, key, on_click),
            "on_selection_change": _noop,
        }

    try:
        result = _renderer(st)(key=key, data=data, width="stretch", **callbacks)
    except Exception as error:
        # Streamlit's own message names an internal element ("bidi_component"), not the call to fix.
        if error.__class__.__name__ != "StreamlitDuplicateElementId":
            raise
        raise InputError(
            "this app draws the same chart twice without key=",
            code="duplicate-chart",
            suggest="Pass a different key= to each bp.st_chart call that draws the same chart, such as key='revenue_sidebar'.",
        ) from error
    if not clicks or result is None:
        return ChartResult()
    click = result.get("click")
    selection = result.get("selection")
    return ChartResult(
        click=click if isinstance(click, dict) else None,
        selection=selection if isinstance(selection, dict) else None,
    )
