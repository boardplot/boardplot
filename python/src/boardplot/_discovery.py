"""Discovery: the engine's own describe and list code, as the MCP tools return it."""

from __future__ import annotations

from typing import Any

from . import _engine
from ._errors import InputError

__all__ = ["describe", "list_charts"]


def _checked(body: dict[str, Any]) -> dict[str, Any]:
    if body.get("ok") is not True:
        errors = body.get("errors") or [{"code": "internal-error", "message": "the engine answered without a result"}]
        raise InputError.from_finding(errors[0], errors)
    return body


def describe(type: str, *, detail: str = "compact", path: str | None = None, schema: str | None = None) -> dict[str, Any]:
    """The authoring contract of one chart type, or of ``"theme"``; the same body as ``boardplot_describe``.

    ``detail`` is ``"compact"`` or ``"full"``. ``path`` narrows to one field, such as
    ``"valueAxis.break"``. ``schema`` (``"data"`` or ``"options"``) returns that JSON Schema.
    """
    payload: dict[str, Any] = {"type": type, "detail": detail}
    if path is not None:
        payload["path"] = path
    if schema is not None:
        payload["schema"] = schema
    return _checked(_engine.call("describe", payload))


def list_charts() -> dict[str, Any]:
    """The chart catalog (types, themes, shared options, limits); the same body as ``boardplot_list``."""
    return _checked(_engine.call("list", {}))
