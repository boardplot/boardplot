"""Errors and warnings.

Every error keeps the engine's fields: ``code``, ``path``, ``message``,
``suggest``, ``fix`` and the full finding in ``details``. ``str()`` is one
readable line, plus a ``Suggest:`` line when there is a suggestion.
"""

from __future__ import annotations

from typing import Any

__all__ = [
    "BoardplotError",
    "InputError",
    "SpecError",
    "RefusalError",
    "EngineUnavailableError",
    "BoardplotWarning",
]


def _line(code: str | None, path: str | None, message: str) -> str:
    head = code or "error"
    if path:
        head += f" at {path}"
    text = message.rstrip()
    if text and not text.endswith((".", "!", "?")):
        text += "."
    return f"{head}: {text}"


class BoardplotError(Exception):
    """A Boardplot error with the engine's code, JSON path, message, suggestion and fix."""

    def __init__(
        self,
        message: str,
        *,
        code: str | None = None,
        path: str | None = None,
        suggest: str | None = None,
        fix: list[dict[str, Any]] | None = None,
        details: dict[str, Any] | None = None,
        errors: list[dict[str, Any]] | None = None,
    ) -> None:
        super().__init__(message)
        self.message = message
        self.code = code
        self.path = path
        self.suggest = suggest
        self.fix = fix
        self.details: dict[str, Any] = dict(details or {})
        #: Every finding of the call, the first one first (the engine sends at most ten and a count).
        self.errors: list[dict[str, Any]] = list(errors or ([self.details] if self.details else []))

    @classmethod
    def from_finding(cls, finding: dict[str, Any], errors: list[dict[str, Any]] | None = None, **extra: Any) -> BoardplotError:
        """Build the error from one engine finding (``code``, ``message``, ``path``, ``suggest``, ``fix``...)."""
        return cls(
            str(finding.get("message") or finding.get("code") or "the engine refused the input"),
            code=finding.get("code"),
            path=finding.get("path") or None,
            suggest=finding.get("suggest"),
            fix=finding.get("fix"),
            details=finding,
            errors=errors,
            **extra,
        )

    def __str__(self) -> str:
        text = _line(self.code, self.path, self.message)
        if len(self.errors) > 1:
            text += f" (+{len(self.errors) - 1} more in .errors)"
        if self.suggest:
            text += f"\nSuggest: {self.suggest}"
        return text


class InputError(BoardplotError):
    """A DataFrame or argument problem found in Python, or an argument the engine refused."""


class SpecError(BoardplotError):
    """The engine refused the spec: schema, theme or rows mapping."""


class RefusalError(BoardplotError):
    """The engine refused to draw at an explicit size, or the chart has no static SVG."""

    def __init__(self, message: str, *, minimum: tuple[int | float, int | float] | None = None, **kwargs: Any) -> None:
        super().__init__(message, **kwargs)
        #: The smallest (width, height) the engine draws this chart at, when the refusal names one.
        self.minimum = minimum


class EngineUnavailableError(BoardplotError):
    """No V8 engine on this platform, a missing engine bundle, or a build identity mismatch."""


class BoardplotWarning(UserWarning):
    """One engine warning: ``code``, ``path``, ``message``, ``suggest``."""

    def __init__(self, message: str, *, code: str | None = None, path: str | None = None, suggest: str | None = None, details: dict[str, Any] | None = None) -> None:
        self.message = message
        self.code = code
        self.path = path
        self.suggest = suggest
        self.details: dict[str, Any] = dict(details or {})
        super().__init__(str(self))

    @classmethod
    def from_finding(cls, finding: dict[str, Any]) -> BoardplotWarning:
        return cls(
            str(finding.get("message") or finding.get("code") or ""),
            code=finding.get("code"),
            path=finding.get("path") or None,
            suggest=finding.get("suggest"),
            details=finding,
        )

    def __str__(self) -> str:
        text = _line(self.code, self.path, self.message)
        if self.suggest:
            text += f" Suggest: {self.suggest}"
        return text

    def __repr__(self) -> str:
        return f"BoardplotWarning({self.code!r}, path={self.path!r})"
