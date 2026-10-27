"""The embedded V8 engine: one lazy instance per process.

``engine.js`` (built by ``python/js/build.mjs``) is the Boardplot CLI's own
render, rows, describe and list code. It loads once, on first use, into a
mini-racer context whose asyncio loop runs on a dedicated daemon thread, so
calls behave the same in scripts, Jupyter (which runs cells inside a loop),
Streamlit and marimo, and every call can time out. Calls are serialized.

Every engine function takes one JSON string and returns one JSON string.
"""

from __future__ import annotations

import asyncio
import json
import os
import platform
import sys
import threading
from importlib import resources
from typing import Any

from ._errors import BoardplotError, EngineUnavailableError

__all__ = ["call", "get_timeout", "set_timeout"]

DEFAULT_TIMEOUT = 60.0
_TIMEOUT_ENV = "BOARDPLOT_ENGINE_TIMEOUT"

_lock = threading.Lock()
_engine: _Engine | None = None
_failure: EngineUnavailableError | None = None
_timeout: float | None = None
_inherited: list[_Engine] = []


def _platform() -> str:
    return f"{sys.platform} {platform.machine() or 'unknown machine'}, Python {platform.python_version()}"


def get_timeout() -> float:
    """Seconds one engine call may run: set_timeout(), else BOARDPLOT_ENGINE_TIMEOUT, else 60."""
    if _timeout is not None:
        return _timeout
    raw = os.environ.get(_TIMEOUT_ENV)
    if raw:
        try:
            value = float(raw)
            if value > 0:
                return value
        except ValueError:
            # An unreadable value falls back to the default timeout.
            pass
    return DEFAULT_TIMEOUT


def set_timeout(seconds: float | None) -> None:
    """Set the per-call timeout in seconds; ``None`` returns to the default."""
    global _timeout
    if seconds is not None and not (isinstance(seconds, (int, float)) and seconds > 0):
        raise ValueError("timeout must be a positive number of seconds, or None")
    _timeout = None if seconds is None else float(seconds)


def _assets_file(name: str) -> str:
    try:
        return resources.files("boardplot").joinpath("_assets", name).read_text(encoding="utf-8")
    except (FileNotFoundError, OSError) as error:
        raise EngineUnavailableError(
            f"the engine bundle _assets/{name} is missing from this installation ({error})",
            code="engine-missing",
            suggest="Install a released boardplot wheel, or in a repository checkout run `node python/js/build.mjs`.",
        ) from None


class _Engine:
    def __init__(self) -> None:
        try:
            from py_mini_racer import JSTimeoutException, mini_racer
        except ImportError as error:
            raise EngineUnavailableError(
                f"the V8 engine (mini-racer) is not available on {_platform()}: {error}",
                code="engine-unavailable",
                suggest="mini-racer ships wheels for macOS, Linux x86_64 and aarch64, and Windows AMD64 and ARM64. "
                "Install boardplot on one of those platforms; Pyodide and JupyterLite are not supported yet.",
            ) from None
        self._timeout_error = JSTimeoutException
        source = _assets_file("engine.js")
        try:
            expected = json.loads(_assets_file("build.json"))["identity"]
        except (KeyError, TypeError, ValueError) as error:
            raise EngineUnavailableError(f"_assets/build.json is not a build record: {error}", code="engine-mismatch") from None

        self._loop = asyncio.new_event_loop()
        self._thread = threading.Thread(target=self._loop.run_forever, name="boardplot-v8", daemon=True)
        self._thread.start()
        # Keep the context manager referenced: when it is collected, the V8 context is freed.
        self._context_manager = mini_racer(self._loop)
        self._ctx = self._context_manager.__enter__()
        try:
            self._ctx.eval(source, timeout_sec=max(get_timeout(), 60.0))
            actual = json.loads(self._ctx.eval("JSON.stringify(Boardplot.identity)"))
        except Exception as error:
            self._loop.call_soon_threadsafe(self._loop.stop)
            raise EngineUnavailableError(f"the engine bundle failed to load on {_platform()}: {error}", code="engine-load-failed") from None
        if actual != expected:
            self._loop.call_soon_threadsafe(self._loop.stop)
            raise EngineUnavailableError(
                f"engine.js has build identity {actual.get('version')!r} (python sources {actual.get('pythonSources')!r}), "
                f"but build.json records {expected.get('version')!r} (python sources {expected.get('pythonSources')!r})",
                code="engine-mismatch",
                suggest="Reinstall boardplot, or rebuild both files with `node python/js/build.mjs`.",
            )

    def call(self, function: str, payload: Any) -> Any:
        argument = json.dumps(payload, ensure_ascii=False, allow_nan=False)
        timeout = get_timeout()
        try:
            result = self._ctx.call(f"Boardplot.{function}", argument, timeout_sec=timeout)
        except self._timeout_error:
            raise BoardplotError(
                f"the engine call {function} ran longer than {timeout:g} s and was stopped",
                code="engine-timeout",
                suggest="Reduce the data to what the chart draws, or raise the limit with BOARDPLOT_ENGINE_TIMEOUT.",
            ) from None
        except Exception as error:
            raise BoardplotError(f"the engine call {function} failed: {error}", code="internal-error") from None
        return json.loads(result)


def _get() -> _Engine:
    """The process's engine. A failed start is remembered, so later calls raise the same error at once."""
    global _engine, _failure
    if _engine is None:
        with _lock:
            if _failure is not None:
                raise _failure
            if _engine is None:
                try:
                    _engine = _Engine()
                except EngineUnavailableError as error:
                    _failure = error
                    raise
    return _engine


def _keep_forever(engine: _Engine) -> None:
    """Never free ``engine`` in this process: freeing its V8 context blocks in a forked child.

    A list reference only lasts until interpreter shutdown, which would then run mini-racer's
    context cleanup; one extra reference count that is never released keeps it alive past that.
    """
    _inherited.append(engine)
    try:
        import ctypes

        ctypes.pythonapi.Py_IncRef(ctypes.py_object(engine))
    except Exception:  # an interpreter without the CPython C API
        pass


def _after_fork_in_child() -> None:
    """A forked child has no V8 threads: every call would hang. Fail fast instead."""
    global _lock, _engine, _failure
    _lock = threading.Lock()
    if _engine is not None:
        _keep_forever(_engine)
        _engine = None
        _failure = EngineUnavailableError(
            "the engine was loaded before this process was forked, and V8 does not run in a forked child",
            code="engine-forked",
            suggest="Draw the charts in the parent process, or start the workers with the 'spawn' or 'forkserver' "
            "method, for example multiprocessing.get_context('spawn').",
        )


if hasattr(os, "register_at_fork"):
    os.register_at_fork(after_in_child=_after_fork_in_child)


def call(function: str, payload: Any = None) -> Any:
    """Call ``Boardplot.<function>`` with one JSON argument and return the parsed JSON result."""
    engine = _get()
    with _lock:
        return engine.call(function, {} if payload is None else payload)
