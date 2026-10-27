"""How a Chart displays: ``auto``, ``widget`` or ``static``.

``static`` shows ``image/svg+xml`` and ``text/plain``. ``widget`` adds the
interactive view from ``boardplot._widget`` (another module of the package)
and keeps the SVG and the text in the same output. ``auto`` is a heuristic:
it picks the widget only when an IPython kernel runs and a live front end is
likely (``JPY_SESSION_NAME`` set by Jupyter Server, a ``VSCODE_*`` variable,
or ``google.colab`` loaded); otherwise static. A kernel started by a batch
runner can inherit those variables, so batch runs set
``BOARDPLOT_DISPLAY=static``.
"""

from __future__ import annotations

import os
import sys
import warnings
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from ._chart import Chart

__all__ = ["set_display", "get_display", "effective_mode", "bundle"]

MODES = ("auto", "widget", "static")
ENV = "BOARDPLOT_DISPLAY"

_mode: str | None = None


def set_display(mode: str) -> None:
    """Set how charts display: ``"auto"`` (default), ``"widget"`` or ``"static"``.

    The environment variable ``BOARDPLOT_DISPLAY`` sets the start value.
    """
    global _mode
    if mode not in MODES:
        from ._errors import InputError

        raise InputError(
            f"display mode must be one of {', '.join(MODES)}, not {mode!r}",
            code="invalid-argument",
            suggest='Pass "auto", "widget" or "static".',
        )
    _mode = mode


def get_display() -> str:
    """The display mode in force: set_display(), else BOARDPLOT_DISPLAY, else auto."""
    if _mode is not None:
        return _mode
    raw = os.environ.get(ENV, "").strip().lower()
    if not raw:
        return "auto"
    if raw in MODES:
        return raw
    warnings.warn(f"{ENV}={raw!r} is not one of {', '.join(MODES)}; using auto", stacklevel=2)
    return "auto"


def _kernel_active() -> bool:
    """An IPython kernel runs this process. Reads IPython only when something else already imported it."""
    ipython = sys.modules.get("IPython")
    if ipython is None or "ipykernel" not in sys.modules:
        return False
    try:
        shell = ipython.get_ipython()
    except Exception:
        return False
    return shell is not None and getattr(shell, "kernel", None) is not None


def _live_front_end_likely() -> bool:
    if os.environ.get("JPY_SESSION_NAME"):
        return True
    if any(key.startswith("VSCODE_") for key in os.environ):
        return True
    return "google.colab" in sys.modules


def effective_mode() -> str:
    """``widget`` or ``static``: what a chart displays as now."""
    mode = get_display()
    if mode != "auto":
        return mode
    return "widget" if _kernel_active() and _live_front_end_likely() else "static"


def static_bundle(chart: Chart) -> dict[str, Any]:
    text = chart._summary()
    if chart.svg is None:
        return {"text/plain": f"{text}\n{chart._no_svg_reason()}"}
    return {"image/svg+xml": chart.svg, "text/plain": text}


def _widget_bundle(chart: Chart) -> Any | None:
    try:
        from ._widget import widget_bundle
    except ModuleNotFoundError as error:
        if error.name == "boardplot._widget":
            return None
        raise
    return widget_bundle(chart)


def bundle(chart: Chart, include: Any = None, exclude: Any = None) -> Any:
    """The IPython mime bundle of a chart in the effective display mode."""
    static = static_bundle(chart)
    if effective_mode() != "widget":
        return static
    view = _widget_bundle(chart)
    if view is None:
        return static
    if isinstance(view, tuple):
        data, metadata = view
        return {**static, **data}, metadata
    return {**static, **view}
