"""DataFrame and row-list conversion."""

from __future__ import annotations

import math
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal

import pandas as pd
import polars as pl
import pytest

import boardplot as bp
from boardplot._convert import to_rows


# Missing values in any library must reach the engine as empty values, never as text or zero.
def test_missing_values_become_null():
    frame = pd.DataFrame({
        "f": [1.5, float("nan"), None],
        "i": pd.array([1, pd.NA, 3], dtype="Int64"),
        "t": pd.to_datetime(["2026-01-01", None, "2026-03-01"]),
        "s": ["a", None, pd.NA],
    })
    rows = to_rows(frame, ["f", "i", "t", "s"])
    assert [r["f"] for r in rows] == [1.5, None, None]
    assert [r["i"] for r in rows] == [1, None, 3]
    assert [r["t"] for r in rows][1] is None
    assert [r["s"] for r in rows] == ["a", None, None]
    polars_rows = to_rows(pl.DataFrame({"f": [1.0, None, float("nan")]}), ["f"])
    assert [r["f"] for r in polars_rows] == [1.0, None, None]


# An infinite value would otherwise turn into invalid JSON or a silent gap.
def test_infinity_raises_with_row_and_column():
    with pytest.raises(bp.InputError) as caught:
        to_rows(pd.DataFrame({"v": [1.0, math.inf]}), ["v"])
    assert "row 1, column 'v'" in str(caught.value)


# An integer beyond 2^53 - 1 would lose digits in JSON without a word.
def test_big_integer_raises():
    with pytest.raises(bp.InputError) as caught:
        to_rows(pl.DataFrame({"id": [2**53]}), ["id"])
    assert caught.value.code == "integer-out-of-range"
    assert to_rows([{"id": 2**53 - 1}], ["id"]) == [{"id": 2**53 - 1}]


# A Decimal must keep its value exactly or be refused, never rounded silently.
def test_decimal_round_trip():
    assert to_rows([{"v": Decimal("12.5")}], ["v"]) == [{"v": 12.5}]
    with pytest.raises(bp.InputError):
        to_rows([{"v": Decimal("0.1000000000000000000001")}], ["v"])


# Datetimes must keep their value, offset and full precision: no polars microsecond truncation,
# no int64 nanosecond overflow outside 1677-2262, no float rounding beside a null; midnight-only
# datetime columns must arrive as the yyyy-mm-dd dates the engine's date role and date axes read,
# while strings keep their exact text, since a template's labels match ids by text.
def test_datetimes_are_iso_with_offset_and_nanoseconds():
    aware = pd.DataFrame({"t": pd.to_datetime(["2026-01-01 12:00:00"]).tz_localize("Europe/Berlin")})
    assert to_rows(aware, ["t"]) == [{"t": "2026-01-01T12:00:00+01:00"}]
    nanos = pl.DataFrame({"t": [datetime(2026, 1, 1, 0, 0, 0)]}).with_columns(
        (pl.col("t").cast(pl.Datetime("ns")) + pl.duration(nanoseconds=123456789)).alias("t"))
    assert to_rows(nanos, ["t"]) == [{"t": "2026-01-01T00:00:00.123456789"}]
    assert to_rows([{"d": date(2026, 2, 3), "u": datetime(2026, 2, 3, 4, 5, tzinfo=timezone(timedelta(hours=-5)))}], ["d", "u"]) == [
        {"d": "2026-02-03", "u": "2026-02-03T04:05:00-05:00"}]
    far = pd.DataFrame({"t": pd.Series([pd.Timestamp("2500-01-01"), pd.Timestamp("1900-06-30 12:00")], dtype="datetime64[us]")})
    assert to_rows(far, ["t"]) == [{"t": "2500-01-01T00:00:00"}, {"t": "1900-06-30T12:00:00"}]
    gap = pd.DataFrame({"t": pd.to_datetime(["2026-01-01 00:00:00.123456789", None])})
    assert to_rows(gap, ["t"]) == [{"t": "2026-01-01T00:00:00.123456789"}, {"t": None}]
    assert to_rows([{"t": pd.Timestamp("2026-01-01 00:00:00.123456789")}], ["t"]) == [{"t": "2026-01-01T00:00:00.123456789"}]
    # Monthly data at midnight reads as dates; one time of day keeps the whole column as datetimes.
    months = pd.DataFrame({"m": pd.date_range("2024-01-01", periods=2, freq="MS")})
    assert to_rows(months, ["m"]) == [{"m": "2024-01-01"}, {"m": "2024-02-01"}]
    assert to_rows([{"m": datetime(2024, 1, 1)}, {"m": datetime(2024, 1, 1, 6)}], ["m"]) == [
        {"m": "2024-01-01T00:00:00"}, {"m": "2024-01-01T06:00:00"}]
    assert to_rows(pl.DataFrame({"m": [datetime(2024, 1, 1), None]}), ["m"]) == [{"m": "2024-01-01"}, {"m": None}]
    text = ["2024-01-01T00:00:00", "2024-02-01T00:00:00"]
    assert to_rows([{"m": value} for value in text], ["m"]) == [{"m": value} for value in text]
    assert to_rows(pd.DataFrame({"m": text}), ["m"]) == [{"m": value} for value in text]


# Categoricals must arrive as their labels and booleans as booleans, not as codes or strings.
def test_categoricals_and_booleans():
    frame = pd.DataFrame({"c": pd.Categorical(["x", "y", "x"]), "b": [True, False, True]})
    assert to_rows(frame, ["c", "b"]) == [{"c": "x", "b": True}, {"c": "y", "b": False}, {"c": "x", "b": True}]
    assert to_rows(pl.DataFrame({"c": ["x", "y"]}, schema={"c": pl.Categorical}), ["c"]) == [{"c": "x"}, {"c": "y"}]


# A lazy frame must be refused with a clear step instead of being collected behind the caller's back.
def test_lazy_frame_raises():
    with pytest.raises(bp.InputError) as caught:
        to_rows(pl.DataFrame({"a": [1]}).lazy(), ["a"])
    assert caught.value.code == "lazy-frame"


# The same data must draw the same chart whichever DataFrame library holds it.
def test_pandas_and_polars_give_the_same_spec():
    data = {"month": ["Jan", "Feb", "Mar"], "region": ["North"] * 3, "revenue": [10.0, 12.5, None]}
    kwargs = dict(category="month", series="region", value="revenue", title="Revenue grows")
    assert bp.chart(pd.DataFrame(data), "line", **kwargs).spec == bp.chart(pl.DataFrame(data), "line", **kwargs).spec
