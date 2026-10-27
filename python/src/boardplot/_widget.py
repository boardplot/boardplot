"""The interactive notebook view: anywidget models for a Boardplot chart.

Two widget classes work together through anywidget 0.11 composition:

- ``BoardplotRuntime`` carries the full browser bundle (``_assets/runtime.js``).
  One instance exists per kernel process. It is never displayed; its front-end
  module only exports ``mount`` and the build identity.
- ``BoardplotWidget`` is one chart view. Its module (``_assets/widget.js``) is
  a small loader that asks the page for the runtime's exports and mounts the
  chart. So the bundle goes to the page once, not once per chart.
"""

from __future__ import annotations

import functools
import json
import weakref
from collections.abc import Callable
from pathlib import Path
from typing import Any

import anywidget
import traitlets

_ASSETS = Path(__file__).parent / "_assets"
_STATES = ("loading", "ready", "refused", "error")

ClickCallback = Callable[[dict[str, Any]], Any]


@functools.cache
def _asset_text(name: str) -> str:
    path = _ASSETS / name
    try:
        return path.read_text(encoding="utf-8")
    except FileNotFoundError:
        msg = (
            f"Boardplot's browser asset {name!r} is missing from {path.parent}. "
            "A source checkout builds it with `node python/js/build.mjs`."
        )
        raise RuntimeError(msg) from None


@functools.cache
def _identity() -> dict[str, Any]:
    """The build identity the browser bundles must carry (``identity`` in ``_assets/build.json``)."""
    data = json.loads(_asset_text("build.json"))
    identity = data.get("identity")
    if not isinstance(identity, dict) or not isinstance(identity.get("version"), str):
        msg = f"{_ASSETS / 'build.json'} has no build identity; rebuild the assets."
        raise RuntimeError(msg)
    return dict(identity)


class BoardplotRuntime(anywidget.AnyWidget):
    """The hidden widget that brings the browser bundle to the page, once per kernel."""

    @property
    def _esm(self) -> str:  # type: ignore[override]
        return _asset_text("runtime.js")


_runtime: BoardplotRuntime | None = None


def _get_runtime() -> BoardplotRuntime:
    """The kernel's runtime widget; a new one after its comm was closed."""
    global _runtime  # noqa: PLW0603
    if _runtime is None or getattr(_runtime, "comm", None) is None:
        _runtime = BoardplotRuntime()
    return _runtime


class BoardplotWidget(anywidget.AnyWidget):
    """The interactive view of one Boardplot chart.

    ``status`` is ``{"state": "loading" | "ready" | "refused" | "error", "revision": n, "detail": ...}``
    as the browser reports it. ``selection`` is the last clicked record.

    Two channels with one job each: every click arrives as a custom message,
    and only that message runs the ``on_click`` callbacks, so a burst of clicks
    loses none. The browser also sets the synced ``selection`` and
    ``event_seq`` traits, so marimo reruns dependent cells; Python runs no
    callback from them.
    """

    @property
    def _esm(self) -> str:  # type: ignore[override]
        return _asset_text("widget.js")

    runtime = anywidget.WidgetTrait().tag(sync=True)
    spec = traitlets.Dict().tag(sync=True)
    hover = traitlets.Bool(True).tag(sync=True)
    fallback_svg = traitlets.Unicode("").tag(sync=True)
    identity = traitlets.Dict().tag(sync=True)
    revision = traitlets.Int(0).tag(sync=True)
    status = traitlets.Dict(read_only=True).tag(sync=True)
    event_seq = traitlets.Int(0).tag(sync=True)
    selection = traitlets.Dict(allow_none=True, default_value=None).tag(sync=True)

    def __init__(
        self, *, spec: dict[str, Any], fallback_svg: str | None = "", summary: str = "", **kwargs: Any
    ) -> None:
        self._summary_text = summary
        self._click_callbacks: list[ClickCallback] = []
        super().__init__(
            runtime=_get_runtime(),
            spec=spec,
            fallback_svg=fallback_svg or "",
            identity=_identity(),
            **kwargs,
        )
        self.set_trait("status", {"state": "loading", "revision": self.revision})
        self.on_msg(self._handle_message)

    def __repr__(self) -> str:
        return self._summary_text or object.__repr__(self)

    @traitlets.observe("spec")
    def _spec_changed(self, _change: dict[str, Any]) -> None:
        # Clicks and status the browser sent for the old spec carry the old revision and are dropped.
        self.revision += 1
        self.set_trait("status", {"state": "loading", "revision": self.revision})

    @traitlets.validate("status")
    def _valid_status(self, proposal: dict[str, Any]) -> dict[str, Any]:
        value = proposal["value"]
        if not isinstance(value, dict) or value.get("state") not in _STATES:
            return self.status
        revision = value.get("revision")
        if isinstance(revision, int) and revision < self.revision:
            return self.status
        return value

    def on_click(self, callback: ClickCallback, *, remove: bool = False) -> None:
        """Call ``callback(record)`` with Boardplot's interaction record on every record click."""
        if remove:
            self._click_callbacks = [c for c in self._click_callbacks if c != callback]
        else:
            self._click_callbacks.append(callback)

    def _handle_message(self, _widget: Any, content: Any, _buffers: Any) -> None:
        if not isinstance(content, dict) or content.get("type") != "event" or content.get("kind") != "record":
            return
        revision = content.get("revision")
        if not isinstance(revision, int) or revision < self.revision:
            return
        record = content.get("record")
        if not isinstance(record, dict):
            return
        for callback in list(self._click_callbacks):
            callback(record)


_widgets: dict[int, tuple[weakref.ref[Any], BoardplotWidget]] = {}


def widget_for(chart: Any) -> BoardplotWidget:
    """The one widget of ``chart``, created on first use."""
    existing = getattr(chart, "_bp_widget", None)
    if isinstance(existing, BoardplotWidget):
        return existing
    entry = _widgets.get(id(chart))
    if entry is not None and entry[0]() is chart:
        return entry[1]
    widget = BoardplotWidget(spec=chart.spec, fallback_svg=chart.svg, summary=chart._summary())
    try:
        object.__setattr__(chart, "_bp_widget", widget)
    except (AttributeError, TypeError):
        # A chart without an instance dict: keep the widget beside it for as long as the chart lives.
        key = id(chart)
        _widgets[key] = (weakref.ref(chart), widget)
        weakref.finalize(chart, _widgets.pop, key, None)
    return widget


def widget_bundle(chart: Any) -> dict[str, Any]:
    """The mime bundle entries of ``chart``'s widget view (the caller adds SVG and text)."""
    bundle = widget_for(chart)._repr_mimebundle_()
    if isinstance(bundle, tuple):
        bundle = bundle[0]
    return dict(bundle or {})
