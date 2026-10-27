"""``bp.chart()`` and the immutable ``Chart``.

A Chart holds one resolved Boardplot spec: the rows are already mapped into
its data by the engine. Creating one validates it and draws the static SVG
once, in V8, with the CLI's own code.
"""

from __future__ import annotations

import copy
import json
import os
import sys
import warnings
from collections.abc import Mapping, Sequence
from pathlib import Path
from typing import Any

from . import _display, _engine
from ._convert import to_rows
from ._errors import BoardplotWarning, InputError, RefusalError, SpecError

__all__ = ["Chart", "chart"]

# The rows roles in Python spelling and as the engine's columns object names them.
ROLE_KEYS: dict[str, str] = {
    "category": "category",
    "series": "series",
    "value": "value",
    "category_label": "categoryLabel",
    "series_label": "seriesLabel",
    "unit": "unit",
    "date": "date",
    "state": "state",
    "label": "label",
    "item_type": "type",
    "x": "x",
    "y": "y",
    "size": "size",
    "group": "group",
}

# The roles each rows shape takes, as readColumns in src/core/rows.ts lists them. A category
# chart's series is optional here: Python adds a constant series when it is missing.
SHAPE_ROLES: dict[str, tuple[str, ...]] = {
    "category": ("category", "series", "value", "category_label", "series_label", "unit", "date", "state"),
    "map": ("category", "value", "state"),
    "waterfall": ("label", "value", "item_type"),
    "scatter": ("x", "y", "size", "label", "group"),
}
REQUIRED_ROLES: dict[str, tuple[str, ...]] = {
    "category": ("category", "value"),
    "map": ("category", "value"),
    "waterfall": ("label", "value"),
    "scatter": ("x", "y"),
}
VALUE_KINDS = ("number", "percent", "fraction")

_shapes: dict[str, Any] | None = None


def _id_text(cell: Any) -> Any:
    """A number in an id or label column as the text a reader expects: 2024, not 2024.0."""
    if isinstance(cell, bool) or not isinstance(cell, (int, float)):
        return cell
    if isinstance(cell, float) and cell.is_integer():
        return str(int(cell))
    return str(cell)


def _rows_shapes() -> dict[str, Any]:
    """Chart types and aliases with their type, and the rows shape of each type that takes rows (from the engine)."""
    global _shapes
    if _shapes is None:
        _shapes = _engine.call("rowsShapes", {})
    return _shapes


def _user_stacklevel() -> int:
    """The stack level of the first frame outside this package, for warnings.warn called right here."""
    package = os.path.dirname(os.path.abspath(__file__))
    level = 1
    frame = sys._getframe(1)
    while frame is not None and os.path.dirname(os.path.abspath(frame.f_code.co_filename)) == package:
        frame = frame.f_back
        level += 1
    return level


def _emit(found: Sequence[BoardplotWarning]) -> None:
    level = _user_stacklevel()
    for warning in found:
        warnings.warn(warning, stacklevel=level)


def _spec_error(body: dict[str, Any]) -> SpecError:
    errors = body.get("errors") or [{"code": "internal-error", "message": "the engine refused the spec without a reason"}]
    return SpecError.from_finding(errors[0], errors)


def _minimum(refusal: Mapping[str, Any] | None) -> tuple[Any, Any] | None:
    minimum = (refusal or {}).get("minimum")
    if isinstance(minimum, Mapping) and isinstance(minimum.get("width"), (int, float)) and isinstance(minimum.get("height"), (int, float)):
        return (minimum["width"], minimum["height"])
    return None


def _refusal_error(refusal: Mapping[str, Any], prefix: str = "") -> RefusalError:
    minimum = _minimum(refusal)
    suggest = f"Draw it at {minimum[0]:g}×{minimum[1]:g} px or larger." if minimum else "Give the chart more room, or fewer labels."
    return RefusalError(
        f"{prefix}{refusal.get('message') or refusal.get('code')}",
        code=refusal.get("code"),
        path=refusal.get("path"),
        suggest=suggest,
        details=dict(refusal),
        minimum=minimum,
    )


def _prepare(payload: dict[str, Any]) -> dict[str, Any]:
    return _engine.call("prepare", payload)


def _is_document(spec: Mapping[str, Any]) -> bool:
    return isinstance(spec.get("charts"), list)


def _chart_part(spec: Mapping[str, Any]) -> Mapping[str, Any]:
    """The one chart of a spec: the bare chart itself, or the only chart of a document."""
    if _is_document(spec):
        charts = spec["charts"]
        return charts[0] if charts and isinstance(charts[0], Mapping) else {}
    return spec


def _place_theme(spec: dict[str, Any], theme: Any) -> None:
    """Clear every competing theme field, then put the explicit theme at the root, which also takes a full theme object."""
    for part in spec["charts"] if _is_document(spec) else [spec]:
        if isinstance(part, dict):
            options = part.get("options")
            if isinstance(options, dict):
                options.pop("theme", None)
            if part is not spec:
                part.pop("theme", None)
    spec["theme"] = copy.deepcopy(theme)


def _build(spec: dict[str, Any], rows: list[dict[str, Any]] | None = None, columns: dict[str, Any] | None = None) -> Chart:
    """Map, validate and draw once; on a size refusal draw once more at the minimum the refusal names."""
    payload: dict[str, Any] = {"spec": spec}
    if rows is not None:
        payload["rows"] = rows
        payload["columns"] = columns
    body = _prepare(payload)
    kind = body.get("kind")
    if kind == "drawn":
        return Chart._create(body, [BoardplotWarning.from_finding(w) for w in body.get("warnings") or []])
    if kind != "refused":
        raise _spec_error(body)
    resolved = body["spec"]
    refusal = body["refusal"]
    minimum = _minimum(refusal)
    if minimum is not None:
        retry = _prepare({"spec": resolved, "width": minimum[0], "height": minimum[1]})
        if retry.get("kind") == "drawn":
            found = [BoardplotWarning.from_finding(w) for w in retry.get("warnings") or []]
            found.append(BoardplotWarning(
                f"the chart does not fit its default size ({refusal.get('message')}); the static SVG is drawn at its minimum, "
                f"{minimum[0]:g}×{minimum[1]:g} px",
                code=refusal.get("code"),
                suggest=f"Give the chart options.size of at least {minimum[0]:g}×{minimum[1]:g} px to choose the size yourself.",
                details=dict(refusal),
            ))
            return Chart._create({**retry, "spec": resolved}, found)
        if retry.get("kind") == "refused":
            refusal = retry["refusal"]
    found = [BoardplotWarning.from_finding(w) for w in body.get("warnings") or []]
    found.append(BoardplotWarning(
        f"no static SVG was drawn: {refusal.get('message')}",
        code=refusal.get("code"),
        suggest="The chart is valid; the interactive view draws it where it fits. Chart.refusal holds the details.",
        details=dict(refusal),
    ))
    return Chart._create(body, found, refusal=dict(refusal))


class _StaticView:
    """What marimo displays for a chart in static mode."""

    def __init__(self, chart: Chart) -> None:
        self._chart = chart

    def _mime_(self) -> tuple[str, str]:
        if self._chart.svg is None:
            return ("text/plain", f"{self._chart._summary()}\n{self._chart._no_svg_reason()}")
        return ("image/svg+xml", self._chart.svg)


def _widget_module() -> Any:
    try:
        from . import _widget
    except ModuleNotFoundError as error:
        if error.name == "boardplot._widget":
            raise ImportError(
                "the interactive notebook view (boardplot._widget) is not part of this installation; "
                "use Chart.svg or bp.set_display('static')"
            ) from None
        raise
    return _widget


class Chart:
    """One resolved Boardplot chart with its static SVG.

    Create it with :func:`boardplot.chart` from a DataFrame, or with
    :meth:`Chart.from_spec` from a spec. A Chart does not change; methods that
    change something return a new Chart.
    """

    _spec: dict[str, Any]
    _svg: str | None
    _size: tuple[Any, Any] | None
    _reading: dict[str, Any] | None
    _notes: list[Any]
    _warnings: list[BoardplotWarning]
    _refusal: dict[str, Any] | None

    def __init__(self) -> None:
        raise TypeError("create a Chart with boardplot.chart(...) or boardplot.Chart.from_spec(...)")

    @classmethod
    def _create(cls, body: Mapping[str, Any], found: list[BoardplotWarning], refusal: dict[str, Any] | None = None) -> Chart:
        self = object.__new__(cls)
        size = body.get("size") if refusal is None else None
        self._spec = body["spec"]
        self._svg = body.get("svg") if refusal is None else None
        self._size = (size["width"], size["height"]) if isinstance(size, Mapping) else None
        self._reading = body.get("reading") if refusal is None else None
        self._notes = list(body.get("notes") or [])
        self._warnings = found
        self._refusal = refusal
        return self

    # Read-only views -----------------------------------------------------------------

    @property
    def spec(self) -> dict[str, Any]:
        """The resolved Boardplot spec (a copy): a bare chart, or a one-chart document."""
        return copy.deepcopy(self._spec)

    @property
    def type(self) -> str | None:
        """The chart type as the spec names it."""
        value = _chart_part(self._spec).get("type")
        return value if isinstance(value, str) else None

    @property
    def theme(self) -> Any:
        """The explicit theme in force: the chart's options.theme, else its root theme, else the document theme, else None."""
        part = _chart_part(self._spec)
        options = part.get("options")
        if isinstance(options, Mapping) and options.get("theme") is not None:
            return copy.deepcopy(options["theme"])
        if part.get("theme") is not None:
            return copy.deepcopy(part["theme"])
        if part is not self._spec and self._spec.get("theme") is not None:
            return copy.deepcopy(self._spec["theme"])
        return None

    @property
    def svg(self) -> str | None:
        """The static SVG, byte-identical to ``boardplot render``; None when the engine refused every size it tried."""
        return self._svg

    @property
    def size(self) -> tuple[Any, Any] | None:
        """(width, height) of the static SVG in px; None without one."""
        return self._size

    @property
    def reading(self) -> dict[str, Any] | None:
        """The engine's reading of the drawn chart (counts, title, labels), as the CLI returns it."""
        return copy.deepcopy(self._reading)

    @property
    def notes(self) -> list[Any]:
        """The notes under the chart, in list order, as the CLI returns them."""
        return copy.deepcopy(self._notes)

    @property
    def warnings(self) -> list[BoardplotWarning]:
        """The findings of the validation render."""
        return list(self._warnings)

    @property
    def refusal(self) -> dict[str, Any] | None:
        """Why there is no static SVG: code, message and the minimum size when the engine names one."""
        return copy.deepcopy(self._refusal)

    # Construction ---------------------------------------------------------------------

    @classmethod
    def from_spec(cls, spec: Mapping[str, Any] | str | os.PathLike[str]) -> Chart:
        """A Chart from a bare chart spec or a one-chart document: a dict, a JSON string, or a path to a JSON file."""
        if isinstance(spec, os.PathLike) or (isinstance(spec, str) and not spec.lstrip().startswith("{")):
            path = Path(spec)
            if not path.is_file():
                raise InputError(
                    f"{str(spec)[:80]!r} is neither a JSON object nor a file",
                    code="invalid-spec",
                    suggest="Pass a dict, a JSON string such as '{\"type\": \"bar\", ...}', or a pathlib.Path to a .json file.",
                )
            text = path.read_text(encoding="utf-8-sig")
        elif isinstance(spec, str):
            text = spec
        elif isinstance(spec, Mapping):
            text = None
        else:
            raise InputError(f"a spec is a dict, a JSON string or a path, not a {type(spec).__name__}", code="invalid-spec")
        if text is not None:
            try:
                parsed = json.loads(text)
            except ValueError as error:
                raise InputError(f"the spec is not valid JSON: {error}", code="invalid-json") from None
        else:
            parsed = copy.deepcopy(dict(spec))  # type: ignore[arg-type]
        if not isinstance(parsed, dict):
            raise InputError("a spec is a JSON object", code="invalid-spec")
        if _is_document(parsed) and len(parsed["charts"]) != 1:
            raise InputError(
                f"a Chart holds one chart; this document has {len(parsed['charts'])}",
                code="invalid-spec",
                path="/charts",
                suggest="Make one Chart per chart of the document.",
            )
        result = _build(parsed)
        _emit(result._warnings)
        return result

    def with_options(self, **options: Any) -> Chart:
        """A new Chart with these options merged over the current ones; this Chart stays as it is."""
        spec = copy.deepcopy(self._spec)
        part = spec["charts"][0] if _is_document(spec) else spec
        merged = dict(part.get("options") or {})
        merged.update(copy.deepcopy(options))
        part["options"] = merged
        result = _build(spec)
        _emit(result._warnings)
        return result

    # Validation and export ------------------------------------------------------------

    def validate(self) -> list[BoardplotWarning]:
        """Run the engine's validation again; return its warnings, raise SpecError on errors."""
        return _build(copy.deepcopy(self._spec))._warnings

    def to_svg(self, width: float | None = None, height: float | None = None, target: str | None = None) -> str:
        """The SVG ``boardplot render`` draws for this spec; with an explicit size or target, drawn at that size.

        Raises RefusalError when the engine refuses the size, or when the chart has no static SVG.
        """
        if width is None and height is None and target is None:
            if self._svg is None:
                raise _refusal_error(self._refusal or {"code": "no-static-svg", "message": "the chart has no static SVG"}, "no static SVG: ")
            return self._svg
        payload: dict[str, Any] = {"spec": self._spec}
        if width is not None:
            payload["width"] = width
        if height is not None:
            payload["height"] = height
        if target is not None:
            payload["target"] = target
        body = _prepare(payload)
        if body.get("kind") == "drawn":
            return body["svg"]
        if body.get("kind") == "refused":
            raise _refusal_error(body["refusal"])
        raise _spec_error(body)

    def save(self, path: str | os.PathLike[str], *, overwrite: bool = False) -> Path:
        """Write the static SVG to ``path`` (.svg). An existing file stays unless ``overwrite=True``."""
        target = Path(path)
        suffix = target.suffix.lower()
        if suffix == ".png":
            raise InputError("PNG export comes in a later release", code="unsupported-format", suggest="Save as .svg.")
        if suffix != ".svg":
            raise InputError(f"save writes .svg files, not {suffix or 'a file without extension'}", code="unsupported-format", suggest="End the path in .svg.")
        svg = self.to_svg()
        with open(target, "w" if overwrite else "x", encoding="utf-8", newline="") as handle:
            handle.write(svg)
        return target

    # Display --------------------------------------------------------------------------

    def widget(self) -> Any:
        """The interactive anywidget view of this chart (one per Chart)."""
        return _widget_module().widget_for(self)

    def on_click(self, callback: Any) -> Any:
        """Call ``callback(record)`` when a reader clicks a record in the widget view."""
        return self.widget().on_click(callback)

    def _display_(self) -> Any:
        """marimo's display hook: the widget, or the static SVG in static mode."""
        if _display.get_display() == "static":
            return _StaticView(self)
        return self.widget()

    def _repr_mimebundle_(self, include: Any = None, exclude: Any = None) -> Any:
        return _display.bundle(self, include, exclude)

    def _no_svg_reason(self) -> str:
        refusal = self._refusal or {}
        minimum = _minimum(refusal)
        text = f"No static SVG: {refusal.get('message') or 'the engine refused every size it tried'} ({refusal.get('code', 'refused')})."
        if minimum:
            text += f" It needs at least {minimum[0]:g}×{minimum[1]:g} px."
        return text

    def _summary(self) -> str:
        parts = [f"<boardplot.Chart {self.type or 'chart'}"]
        if self._size is not None:
            parts[0] += f" {self._size[0]:g}×{self._size[1]:g}"
        else:
            parts[0] += f" · no static SVG ({(self._refusal or {}).get('code', 'refused')})"
        for count in (self._reading or {}).get("counts") or []:
            if isinstance(count, Mapping) and count.get("text"):
                parts.append(str(count["text"]))
        codes = sorted({w.code for w in self._warnings if w.code})
        parts.append(f"warnings: {', '.join(codes) if codes else 'none'}")
        return " · ".join(parts) + ">"

    def __repr__(self) -> str:
        return self._summary()


def _role_columns(shape: str, roles: dict[str, Any], type_name: str) -> None:
    """Refuse roles the shape does not take, and missing required roles."""
    allowed = SHAPE_ROLES[shape]
    given = [role for role, value in roles.items() if value is not None]
    wrong = [role for role in given if role not in allowed]
    if wrong:
        hint = ""
        if shape in ("category", "map") and any(role in ("x", "y") for role in wrong):
            hint = " For a category chart, name the category column with category= and the numbers with value=."
        raise InputError(
            f"'{type_name}' does not take {', '.join(f'{role}=' for role in wrong)}; it takes "
            f"{', '.join(f'{role}=' for role in allowed)}.{hint}",
            code="invalid-role",
            suggest=f"Use {', '.join(f'{role}=' for role in REQUIRED_ROLES[shape])} for '{type_name}'.",
        )
    missing = [role for role in REQUIRED_ROLES[shape] if roles.get(role) is None]
    if missing:
        raise InputError(
            f"'{type_name}' needs {', '.join(f'{role}=' for role in missing)} naming the source column",
            code="missing-role",
            suggest=f"Pass {', '.join(f'{role}=' for role in REQUIRED_ROLES[shape])}.",
        )
    for role in given:
        value = roles[role]
        if role == "value" and isinstance(value, (list, tuple)):
            continue
        if not isinstance(value, str) or not value:
            raise InputError(f"{role}= names one source column as a non-empty string, not {value!r}", code="invalid-role")


def _private(base: str, used: set[str]) -> str:
    name = base
    while name in used:
        name += "_"
    used.add(name)
    return name


def chart(
    data: Any,
    /,
    type: str = "column",
    *,
    category: str | None = None,
    series: str | None = None,
    value: str | Sequence[str] | None = None,
    category_label: str | None = None,
    series_label: str | None = None,
    unit: str | None = None,
    date: str | None = None,
    state: str | None = None,
    label: str | None = None,
    item_type: str | None = None,
    x: str | None = None,
    y: str | None = None,
    size: str | None = None,
    group: str | None = None,
    value_kind: str = "number",
    pack: str | None = None,
    title: str | None = None,
    options: Mapping[str, Any] | None = None,
    annotations: Sequence[Any] | None = None,
    theme: Any = None,
    name: str | None = None,
    template: Mapping[str, Any] | None = None,
) -> Chart:
    """A chart from a DataFrame or a list of row dicts.

    Each role names a source column (see the README's roles table). A category
    chart without ``series`` draws one series named after the value column;
    ``value=["a", "b"]`` draws one series per column. ``options`` are the
    Boardplot spec options; ``title=`` is short for ``options["title"]``.
    """
    if not isinstance(type, str) or not type:
        raise InputError(f"type is a chart type name such as 'bar', not {type!r}", code="invalid-argument")
    if value_kind not in VALUE_KINDS:
        raise InputError(f"value_kind must be one of {', '.join(VALUE_KINDS)}, not {value_kind!r}", code="invalid-argument",
                         suggest="fraction when a share arrives as 0.5, percent when it arrives as 50, number otherwise.")
    shapes = _rows_shapes()
    canonical = shapes["types"].get(type)
    shape = shapes["shapes"].get(canonical) if canonical else None
    if canonical is not None and shape is None:
        rows_types = sorted(shapes["shapes"])
        raise InputError(
            f"'{type}' has no rows mapping, so it cannot draw a DataFrame directly",
            code="rows-unsupported-type",
            suggest=f"Write its spec and use boardplot.Chart.from_spec(), or draw the rows as one of: {', '.join(rows_types)}.",
        )
    roles = {
        "category": category, "series": series, "value": value, "category_label": category_label,
        "series_label": series_label, "unit": unit, "date": date, "state": state, "label": label,
        "item_type": item_type, "x": x, "y": y, "size": size, "group": group,
    }
    # An unknown type is the engine's to refuse, with its own suggestions; map its roles as a category chart's.
    _role_columns(shape or "category", roles, type)

    values: list[str] | None = None
    if isinstance(value, (list, tuple)):
        values = list(value)
        if not values or not all(isinstance(v, str) and v for v in values):
            raise InputError("value= takes one column name, or a list of column names", code="invalid-role")
        if len(set(values)) != len(values):
            raise InputError("value= lists a column twice", code="invalid-role")
        if len(values) > 1 and (shape or "category") != "category":
            raise InputError(f"'{type}' takes one value column, not {len(values)}", code="invalid-role")
        if len(values) > 1 and series is not None:
            raise InputError("with series=, value= names one column", code="invalid-role",
                             suggest="Drop series= to draw one series per value column, or pass one value column.")
        if len(values) == 1:
            value, values = values[0], None

    # The source columns, in role order, each once.
    mapped: list[str] = []
    for role in ROLE_KEYS:
        column = roles[role] if role != "value" else (None if values else value)
        if isinstance(column, str) and column not in mapped:
            mapped.append(column)
    for column in values or []:
        if column not in mapped:
            mapped.append(column)
    rows = to_rows(data, mapped)
    # The engine takes ids and labels as text: a year column (2024) becomes "2024".
    numeric = {roles["x"], roles["y"], roles["size"], *(values or [value])}
    for role in ("category", "series", "category_label", "series_label", "label", "group"):
        column = roles[role]
        if isinstance(column, str) and column not in numeric:
            for row in rows:
                if column in row:
                    row[column] = _id_text(row[column])

    columns: dict[str, Any] = {ROLE_KEYS[role]: roles[role] for role in ROLE_KEYS if role != "value" and roles[role] is not None}
    used = set(mapped)
    if (shape or "category") == "category" and series is None:
        series_column = _private("__boardplot_series", used)
        columns["series"] = series_column
        if values:
            value_column = _private("__boardplot_value", used)
            keep = [column for column in mapped if column not in values]
            long_rows: list[dict[str, Any]] = []
            for row in rows:
                for name_ in values:
                    entry = {column: row[column] for column in keep if column in row}
                    entry[series_column] = name_
                    if name_ in row:
                        entry[value_column] = row[name_]
                    long_rows.append(entry)
            rows = long_rows
            columns["value"] = value_column
        else:
            for row in rows:
                row[series_column] = value
            columns["value"] = value
    elif value is not None:
        columns["value"] = value
    if value_kind != "number":
        columns["valueKind"] = value_kind

    if template is not None and not isinstance(template, Mapping):
        raise InputError("template= is a partial bare chart spec (a dict)", code="invalid-argument")
    spec: dict[str, Any] = copy.deepcopy(dict(template or {}))
    if _is_document(spec):
        raise InputError("template= is a bare chart spec, not a document with charts", code="invalid-argument")
    spec["type"] = type
    if name is not None:
        spec["name"] = name
    merged_options = dict(spec.get("options") or {})
    if options is not None:
        if not isinstance(options, Mapping):
            raise InputError("options= is a dict of Boardplot spec options", code="invalid-argument")
        merged_options.update(copy.deepcopy(dict(options)))
    if title is not None:
        if options is not None and "title" in options:
            raise InputError("pass title= or options['title'], not both", code="invalid-argument",
                             suggest="Keep one of them; title= is short for options['title'].")
        merged_options["title"] = title
    if merged_options:
        spec["options"] = merged_options
    if annotations is not None:
        spec["annotations"] = copy.deepcopy(list(annotations))
    if pack is not None:
        if shape != "map":
            raise InputError(f"pack= belongs to choropleth and tilemap, not '{type}'", code="invalid-argument")
        data_part = dict(spec.get("data") or {})
        data_part["pack"] = pack
        spec["data"] = data_part
    elif shape == "map" and not (isinstance(spec.get("data"), Mapping) and spec["data"].get("pack")):
        raise InputError(f"'{type}' needs pack= naming its geo pack", code="missing-pack",
                         suggest="Pass pack=, for example pack='world'; bp.describe('choropleth', path='data.pack') lists the packs.")
    if theme is not None:
        _place_theme(spec, theme)

    result = _build(spec, rows, columns)
    _emit(result._warnings)
    return result
