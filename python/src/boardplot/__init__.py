"""Boardplot for Python: consulting-grade charts from DataFrames.

    import boardplot as bp
    c = bp.chart(df, "bar", category="region", value="revenue", title="East leads revenue")

Importing the package starts no engine and imports no notebook library; the
V8 engine loads on the first chart, describe or list call.
"""

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
]
