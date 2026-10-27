"""DataFrame and row-list input to JSON rows.

Frames are read through narwhals (``eager_only=True``), so pandas, polars,
pyarrow and every other eager frame narwhals supports work without this
package importing any of them. Only the mapped columns are read. Row order is
kept; a pandas index is ignored. Python never reshapes, sorts or aggregates
beyond what the caller asked for: the engine maps the rows.
"""

from __future__ import annotations

import math
import re
from collections.abc import Mapping, Sequence
from datetime import date, datetime, time, timedelta, timezone
from decimal import Decimal, InvalidOperation
from typing import Any

from ._errors import InputError

__all__ = ["to_rows"]

MAX_SAFE_INTEGER = 2**53 - 1


def _where(row: int, column: str) -> str:
    return f"row {row}, column '{column}'"


def _integer(value: int, row: int, column: str) -> int:
    if abs(value) > MAX_SAFE_INTEGER:
        raise InputError(
            f"{_where(row, column)}: {value} is outside ±(2^53 - 1), so JSON cannot carry it exactly",
            code="integer-out-of-range",
            suggest=f"If '{column}' is an identifier, convert it to strings first; if it is a measure, scale it down.",
        )
    return value


def _float(value: float, row: int, column: str) -> float | None:
    if math.isnan(value):
        return None
    if math.isinf(value):
        raise InputError(
            f"{_where(row, column)}: {value} is infinite; a chart cannot draw it",
            code="infinite-value",
            suggest="Replace infinite values with a number or with None (an empty value) before charting.",
        )
    return value


def _decimal(value: Decimal, row: int, column: str) -> float | None:
    if value.is_nan():
        return None
    if value.is_infinite():
        return _float(float(value), row, column)
    as_float = float(value)
    try:
        exact = Decimal(repr(as_float)) == value
    except InvalidOperation:
        exact = False
    if not exact:
        raise InputError(
            f"{_where(row, column)}: Decimal {value} has no exact float; converting it would change the number",
            code="inexact-decimal",
            suggest=f"Round '{column}' to the precision the chart shows, or convert it to float yourself.",
        )
    return as_float


def _is_missing(value: Any) -> bool:
    if value is None:
        return True
    name = type(value).__name__
    if name in ("NAType", "NaTType"):
        return True
    return False


def _scalar(value: Any, row: int, column: str) -> Any:
    """One cell to a JSON value: None, bool, int, float or str."""
    if _is_missing(value):
        return None
    if isinstance(value, bool):
        return value
    if isinstance(value, int):
        return _integer(int(value), row, column)
    if isinstance(value, float):
        return _float(float(value), row, column)
    if isinstance(value, str):
        return value
    if isinstance(value, Decimal):
        return _decimal(value, row, column)
    if isinstance(value, (datetime, date, time)):
        # ISO 8601; a pandas Timestamp's isoformat() already holds its nanoseconds.
        return value.isoformat()
    if isinstance(value, timedelta):
        raise InputError(
            f"{_where(row, column)}: a duration has no chart value",
            code="unsupported-value",
            suggest=f"Convert '{column}' to a number, for example hours or days, before charting.",
        )
    item = getattr(value, "item", None)  # numpy and pyarrow scalars
    if callable(item) and type(value).__module__.split(".")[0] in ("numpy", "pyarrow"):
        converted = item() if type(value).__module__.startswith("numpy") else value.as_py()
        if converted is not value:
            return _scalar(converted, row, column)
    raise InputError(
        f"{_where(row, column)}: a {type(value).__name__} value has no JSON form",
        code="unsupported-value",
        suggest=f"Convert '{column}' to numbers, strings, booleans or dates before charting.",
    )


_MIDNIGHT = re.compile(r"\d{4}-\d{2}-\d{2}T00:00:00")


def _midnight_dates(values: list[Any]) -> list[Any]:
    """A naive datetime column whose values all fall on midnight, as ISO dates (yyyy-mm-dd).

    Monthly or daily data then reads as dates: a category axis prints them as dates, and the
    ``date`` role, which takes yyyy-mm-dd, accepts the column. Only datetime columns come here;
    strings keep their exact text, because an id must match the labels of a template.
    """
    texts = [value for value in values if value is not None]
    if texts and all(isinstance(text, str) and _MIDNIGHT.fullmatch(text) for text in texts):
        return [None if value is None else value[:10] for value in values]
    return values


def _datetime_column(series: Any, dtype: Any, mask: list[bool], column: str) -> list[Any]:
    """Datetimes to ISO 8601 at full precision; a timezone-aware value keeps its offset."""
    zone_name = getattr(dtype, "time_zone", None)
    zone: Any = None
    if zone_name:
        try:
            from zoneinfo import ZoneInfo

            zone = ZoneInfo(zone_name)
        except Exception:
            zone = None
    if zone_name and zone is None:
        # A zone this Python cannot load (no tz database, or a fixed offset name): the library's
        # own datetime objects carry the offset, at microsecond precision.
        return [None if missing else _scalar(value, row, column) for row, (value, missing) in enumerate(zip(series.to_list(), mask))]
    # Integers in the column's own unit (seconds as milliseconds): nanoseconds overflow int64 outside 1677-2262.
    unit = {"s": "ms", "ms": "ms", "us": "us", "ns": "ns"}.get(getattr(dtype, "time_unit", None), "us")
    width = {"ms": 3, "us": 6, "ns": 9}[unit]
    stamps = series.dt.timestamp(unit).to_list()
    if any(isinstance(stamp, float) for stamp in stamps):
        # pandas turns an integer column with a null into floats, which drop digits beyond 2**53;
        # the library's own datetime objects keep them (a pandas Timestamp holds nanoseconds).
        return [None if missing else _scalar(value, row, column) for row, (value, missing) in enumerate(zip(series.to_list(), mask))]
    # Epoch plus a timedelta, not fromtimestamp(), which fails before 1970 on Windows.
    epoch = datetime(1970, 1, 1, tzinfo=timezone.utc if zone is not None else None)
    out: list[Any] = []
    for row, (missing, stamp) in enumerate(zip(mask, stamps)):
        if missing or stamp is None:
            out.append(None)
            continue
        seconds, fraction = divmod(int(stamp), 10**width)
        try:
            moment = epoch + timedelta(seconds=seconds)
            if zone is not None:
                moment = moment.astimezone(zone)
        except (OverflowError, ValueError):
            raise InputError(
                f"{_where(row, column)}: the datetime is outside the years 1 to 9999",
                code="unsupported-value",
                suggest=f"Filter '{column}' to the period the chart shows.",
            ) from None
        text = moment.isoformat(timespec="seconds")
        digits = f".{fraction:0{width}d}".rstrip("0") if fraction else ""
        out.append(text[:19] + digits + text[19:])
    return out


def _frame_rows(frame: Any, columns: Sequence[str]) -> list[dict[str, Any]]:
    import narwhals as nw

    available = list(frame.columns)
    missing = [name for name in columns if name not in available]
    if missing:
        raise InputError(
            f"the data has no column {', '.join(repr(name) for name in missing)}",
            code="unknown-column",
            suggest=f"Use one of: {', '.join(repr(str(name)) for name in available)}.",
        )
    height = len(frame)
    converted: dict[str, list[Any]] = {}
    for name in columns:
        if name in converted:
            continue
        series = frame.get_column(name)
        dtype = series.dtype
        mask = [bool(flag) for flag in series.is_null().to_list()]
        if isinstance(dtype, nw.Datetime):
            converted[name] = _datetime_column(series, dtype, mask, name)
            if not getattr(dtype, "time_zone", None):
                converted[name] = _midnight_dates(converted[name])
        elif isinstance(dtype, nw.Duration):
            raise InputError(
                f"column '{name}' holds durations, which have no chart value",
                code="unsupported-value",
                suggest=f"Convert '{name}' to a number, for example hours or days, before charting.",
            )
        else:
            values = series.to_list()
            converted[name] = [None if missing else _scalar(value, row, name) for row, (value, missing) in enumerate(zip(values, mask))]
    return [{name: converted[name][row] for name in columns} for row in range(height)]


def _list_rows(data: Sequence[Any], columns: Sequence[str]) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    seen: set[str] = set()
    naive = set(columns)  # columns with no value yet that is not a naive datetime
    for index, row in enumerate(data):
        if not isinstance(row, Mapping):
            raise InputError(
                f"row {index} is a {type(row).__name__}, not a mapping of column names to values",
                code="invalid-rows",
                suggest="Pass a DataFrame, or a list of dicts such as [{'region': 'North', 'revenue': 42.0}].",
            )
        out: dict[str, Any] = {}
        for name in columns:
            if name in row:
                seen.add(name)
                value = row[name]
                out[name] = _scalar(value, index, name)
                if out[name] is not None and not (isinstance(value, datetime) and value.tzinfo is None):
                    naive.discard(name)
        rows.append(out)
    unseen = [name for name in columns if name not in seen]
    if rows and unseen:
        keys = sorted({str(key) for row in data for key in row})
        raise InputError(
            f"no row has the column {', '.join(repr(name) for name in unseen)}",
            code="unknown-column",
            suggest=f"Use one of: {', '.join(repr(key) for key in keys)}.",
        )
    for name in naive & seen:
        dates = _midnight_dates([row.get(name) for row in rows])
        for row, value in zip(rows, dates):
            if name in row:
                row[name] = value
    return rows


def to_rows(data: Any, columns: Sequence[str]) -> list[dict[str, Any]]:
    """The mapped ``columns`` of ``data`` as JSON-ready row dicts, in row order."""
    if isinstance(data, (list, tuple)):
        return _list_rows(data, columns)
    import narwhals as nw

    native = nw.from_native(data, pass_through=True)
    if isinstance(native, nw.LazyFrame):
        raise InputError(
            "the data is a lazy frame; Boardplot reads eager frames only",
            code="lazy-frame",
            suggest="Collect it first, for example df.collect() in polars.",
        )
    if not isinstance(native, nw.DataFrame):
        raise InputError(
            f"cannot read a {type(data).__module__}.{type(data).__name__} as rows",
            code="invalid-data",
            suggest="Pass an eager DataFrame (pandas, polars, pyarrow) or a list of dicts.",
        )
    return _frame_rows(native, columns)
