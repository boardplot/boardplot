"""Parity sweep: the Python engine against the Boardplot CLI.

A manual script, not a test. It needs a repository checkout with `npm ci`
done, the assets built (`node python/js/build.mjs`) and a Python environment
with boardplot installed. Run it from anywhere:

    python python/scripts/parity_sweep.py  # every fixture
    python python/scripts/parity_sweep.py --types column,line,table,choropleth,waterfall --kind example --limit 1

What it compares, byte for byte:
- render: every fixture (as authored, and under the notation theme as
  tests/golden/render.ts renders it), CLI render body against the engine's;
- rows: for every fixture whose data converts to flat rows, `render --rows`
  against the engine's `prepare` (SVG and resolved spec);
- describe (compact and full) for each selected type and theme, and list.

The CLI side runs in one Node process (python/js/parity/cli-batch.ts), which
calls the CLI's verb functions as `boardplot <verb>` does after parsing flags.
The summary goes to stdout; the exit code is 1 on any mismatch.

SVG bytes must match exactly. A JSON body whose only difference is a float in
the last digits (relative 1e-12) is listed as "float-only", not as a mismatch:
V8 versions round `**` differently in the last bit, so the CLI itself gives
such numbers (for example colour distances in warning details) differently on
Node 22 (V8 12.4) and Node 24 (V8 13.6); the engine's V8 agrees with Node 24.
"""

from __future__ import annotations

import argparse
import copy
import json
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]


def canonical(value: Any) -> str:
    return json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(",", ":"))


def float_only(a: Any, b: Any) -> bool:
    """The same JSON, except floats that differ in the last digits (relative 1e-12)."""
    if isinstance(a, float) and isinstance(b, float):
        return abs(a - b) <= 1e-12 * max(abs(a), abs(b))
    if type(a) is not type(b):
        return False
    if isinstance(a, dict):
        return a.keys() == b.keys() and all(float_only(a[k], b[k]) for k in a)
    if isinstance(a, list):
        return len(a) == len(b) and all(float_only(x, y) for x, y in zip(a, b))
    return a == b


def cli_batch(requests: list[dict[str, Any]]) -> list[dict[str, Any]]:
    npx = shutil.which("npx")
    if npx is None:
        sys.exit("parity_sweep: npx not found; install Node 22 and run `npm ci` in the repository")
    with tempfile.TemporaryDirectory(prefix="bp-parity-") as folder:
        source = Path(folder) / "in.jsonl"
        target = Path(folder) / "out.jsonl"
        source.write_text("\n".join(json.dumps(r, ensure_ascii=False) for r in requests) + "\n", encoding="utf-8")
        subprocess.run([npx, "tsx", "python/js/parity/cli-batch.ts", str(source), str(target)], cwd=ROOT, check=True)
        return [json.loads(line) for line in target.read_text(encoding="utf-8").splitlines() if line.strip()]


def engine_call(function: str, payload: dict[str, Any]) -> dict[str, Any]:
    from boardplot import _engine

    return _engine.call(function, payload)


def rows_case(spec: dict[str, Any], shape: str) -> tuple[dict[str, Any], list[dict[str, Any]], dict[str, str]] | None:
    """Flat rows, columns and a template spec for a fixture whose data converts losslessly; None otherwise."""
    data = spec.get("data")
    if not isinstance(data, dict):
        return None
    template = {key: copy.deepcopy(value) for key, value in spec.items() if key != "data"}
    plain = lambda v: v is None or (isinstance(v, (int, float)) and not isinstance(v, bool))  # noqa: E731
    if shape == "category":
        categories, series = data.get("categories"), data.get("series")
        if not isinstance(categories, list) or not isinstance(series, list):
            return None
        ids = [c if isinstance(c, str) else c.get("id") if isinstance(c, dict) else None for c in categories]
        if not all(isinstance(i, str) for i in ids):
            return None
        rows = []
        for entry in series:
            if not isinstance(entry, dict) or not isinstance(entry.get("id"), str) or not isinstance(entry.get("values"), list):
                return None
            if len(entry["values"]) != len(ids) or not all(plain(v) for v in entry["values"]):
                return None
            rows += [{"c": cid, "s": entry["id"], "v": v} for cid, v in zip(ids, entry["values"])]
        template["data"] = {k: copy.deepcopy(v) for k, v in data.items() if k not in ("categories", "series")}
        return template, rows, {"category": "c", "series": "s", "value": "v"}
    if shape == "map":
        regions = data.get("regions")
        if not isinstance(regions, list) or not all(isinstance(r, dict) and isinstance(r.get("id"), str) and plain(r.get("value")) and set(r) <= {"id", "value"} for r in regions):
            return None
        template["data"] = {k: copy.deepcopy(v) for k, v in data.items() if k != "regions"}
        return template, [{"c": r["id"], "v": r.get("value")} for r in regions], {"category": "c", "value": "v"}
    if shape == "waterfall":
        items = data.get("items")
        if not isinstance(items, list) or not all(isinstance(i, dict) and isinstance(i.get("label"), str) and plain(i.get("value")) and set(i) <= {"label", "value", "type"} for i in items):
            return None
        template["data"] = {k: copy.deepcopy(v) for k, v in data.items() if k != "items"}
        rows = [{"l": i["label"], "v": i.get("value"), **({"t": i["type"]} if "type" in i else {})} for i in items]
        return template, rows, {"label": "l", "value": "v", **({"type": "t"} if any("t" in r for r in rows) else {})}
    if shape == "scatter":
        points = data.get("points")
        if not isinstance(points, list) or not all(isinstance(p, dict) and plain(p.get("x")) and plain(p.get("y")) and set(p) <= {"x", "y"} for p in points):
            return None
        template["data"] = {k: copy.deepcopy(v) for k, v in data.items() if k != "points"}
        return template, [{"x": p.get("x"), "y": p.get("y")} for p in points], {"x": "x", "y": "y"}
    return None


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--types", help="comma-separated chart types (default: all)")
    parser.add_argument("--kind", choices=["example", "torture", "all"], default="all", help="fixture kind (default: all)")
    parser.add_argument("--limit", type=int, help="at most this many fixtures per type")
    parser.add_argument("--variants", default="authored,notation", help="authored, notation or both (default)")
    parser.add_argument("--skip-rows", action="store_true", help="skip the rows comparison")
    parser.add_argument("--skip-describe", action="store_true", help="skip describe and list")
    args = parser.parse_args()

    wanted = [t.strip() for t in args.types.split(",")] if args.types else None
    variants = [v.strip() for v in args.variants.split(",") if v.strip()]
    if not set(variants) <= {"authored", "notation"}:
        sys.exit("parity_sweep: --variants takes authored and notation")

    listing = cli_batch([{"op": "fixtures", "input": {"kind": args.kind}}])[0]
    fixtures = listing["fixtures"]
    if wanted:
        unknown = sorted(set(wanted) - {f["type"] for f in fixtures})
        if unknown:
            sys.exit(f"parity_sweep: no fixtures for {', '.join(unknown)}")
        fixtures = [f for f in fixtures if f["type"] in wanted]
    if args.limit is not None:
        kept: list[dict[str, Any]] = []
        per_type: dict[str, int] = {}
        for f in fixtures:
            if per_type.get(f["type"], 0) < args.limit:
                kept.append(f)
                per_type[f["type"]] = per_type.get(f["type"], 0) + 1
        fixtures = kept

    labels: list[str] = []
    requests: list[dict[str, Any]] = []
    engine_side: list[tuple[str, dict[str, Any]]] = []
    for f in fixtures:
        for variant in variants:
            spec = copy.deepcopy(f["spec"])
            if variant == "notation":
                spec["options"] = {**(spec.get("options") or {}), "theme": "notation"}
            labels.append(f"render {f['type']}/{f['id']}.{variant}")
            requests.append({"op": "render", "input": {"spec": spec}})
            engine_side.append(("render", {"spec": spec}))

    rows_labels: list[str] = []
    rows_skipped = 0
    if not args.skip_rows:
        shapes = engine_call("rowsShapes", {})
        for f in fixtures:
            shape = shapes["shapes"].get(f["type"])
            case = rows_case(f["spec"], shape) if shape else None
            if case is None:
                rows_skipped += shape is not None
                continue
            template, rows, columns = case
            payload = {"spec": template, "rows": rows, "columns": columns}
            rows_labels.append(f"rows {f['type']}/{f['id']}")
            requests.append({"op": "render", "input": payload})
            requests.append({"op": "rows-spec", "input": payload})
            engine_side.append(("prepare", payload))

    describe_labels: list[str] = []
    if not args.skip_describe:
        types = wanted or sorted({t["type"] for t in engine_call("list", {})["types"]})
        for name in [*types, "theme"]:
            for detail in ("compact", "full"):
                describe_labels.append(f"describe {name} {detail}")
                requests.append({"op": "describe", "input": {"type": name, "detail": detail}})
                engine_side.append(("describe", {"type": name, "detail": detail}))
        describe_labels.append("list")
        requests.append({"op": "list", "input": {}})
        engine_side.append(("list", {}))

    print(f"parity_sweep: {len(labels)} renders, {len(rows_labels)} rows cases ({rows_skipped} fixtures without flat rows), "
          f"{len(describe_labels)} describe/list calls", flush=True)
    cli = iter(cli_batch(requests))
    mismatches: list[str] = []
    floats: list[str] = []
    counts = {"render": 0, "rows": 0, "describe": 0}
    for label, (function, payload) in zip([*labels, *rows_labels, *describe_labels], engine_side):
        mine = engine_call(function, payload)
        theirs = next(cli)
        if function == "prepare":
            spec_body = next(cli)
            counts["rows"] += 1
            if mine.get("svg") != theirs.get("svg") or bool(mine.get("ok")) != bool(theirs.get("ok")):
                mismatches.append(f"{label}: SVG or outcome differs (engine kind {mine.get('kind')}, CLI ok {theirs.get('ok')})")
            elif theirs.get("ok") and canonical(mine.get("spec")) != canonical(spec_body.get("spec")):
                mismatches.append(f"{label}: resolved spec differs")
            elif canonical(mine.get("warnings")) != canonical(theirs.get("warnings")):
                (floats if float_only(mine.get("warnings"), theirs.get("warnings")) else mismatches).append(f"{label}: warnings differ")
            continue
        counts["render" if function == "render" else "describe"] += 1
        if function == "render" and mine.get("svg") != theirs.get("svg"):
            mismatches.append(f"{label}: SVG bytes differ")
        elif canonical(mine) != canonical(theirs):
            (floats if float_only(mine, theirs) else mismatches).append(f"{label}: body differs")

    print(f"compared: {counts['render']} renders, {counts['rows']} rows cases, {counts['describe']} describe/list calls")
    if floats:
        print(f"float-only: {len(floats)} (floats differ in the last digits; see the module docstring)")
        for line in floats:
            print(f"  {line}")
    if mismatches:
        print(f"MISMATCH: {len(mismatches)}")
        for line in mismatches:
            print(f"  {line}")
        return 1
    print("MATCH: no differences")
    return 0


if __name__ == "__main__":
    sys.exit(main())
