"""Boardplot for Python: consulting-grade charts from DataFrames.

    import boardplot as bp
    c = bp.chart(df, "bar", category="region", value="revenue", title="East leads revenue")

Importing the package starts no engine and imports no notebook library or
Streamlit; the V8 engine loads on the first chart, describe or list call.
"""

from typing import Any as _Any

from ._chart import Chart, chart
from ._discovery import describe, list_charts
from ._display import set_display
from ._errors import (
    BoardplotError,
    BoardplotWarning,
    EngineUnavailableError,
    InputError,
    RefusalError,
    SpecError,
)


def st_chart(chart_or_data: _Any, type: str | None = None, *, key: str | None = None,
             on_click: _Any = "ignore", theme: _Any = None, **chart_kwargs: _Any) -> _Any:
    """Draw a Boardplot chart in a Streamlit app, at the width of its container.

    ``chart_or_data`` is a Chart, or data with the ``bp.chart`` arguments:
    ``bp.st_chart(df, "bar", category="region", value="revenue")``.
    ``on_click``: "ignore" (default, sends nothing), "rerun" (``result.click``
    and ``result.selection`` hold the record), or a function that takes the
    record (needs ``key=``). Without ``theme=`` the chart follows the app theme.

    Needs Streamlit 1.59 or later: ``pip install "boardplot[streamlit]"``.
    Streamlit is imported only when this function runs.
    """
    from ._streamlit import st_chart as _st_chart

    return _st_chart(chart_or_data, type, key=key, on_click=on_click, theme=theme, **chart_kwargs)


try:
    from ._version import __version__
except ImportError:  # a source checkout before `node python/js/build.mjs`
    __version__ = "0.0.0+unknown"

__all__ = [
    "BoardplotError",
    "BoardplotWarning",
    "Chart",
    "EngineUnavailableError",
    "InputError",
    "RefusalError",
    "SpecError",
    "__version__",
    "chart",
    "describe",
    "list_charts",
    "set_display",
    "st_chart",
]
