"""Shared helpers: the Boardplot CLI from the repository checkout, for the parity tests."""

from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path
from typing import Any

import pytest

ROOT = Path(__file__).resolve().parents[2]
CI_TYPES = ("column", "line", "table", "choropleth", "waterfall")


class Cli:
    """`npx tsx src/cli/index.ts <args>` from the repository root, answering with the parsed JSON body."""

    def __init__(self, npx: str) -> None:
        self.npx = npx

    def run(self, *args: str) -> dict[str, Any]:
        done = subprocess.run([self.npx, "tsx", "src/cli/index.ts", *args], cwd=ROOT, capture_output=True, text=True, encoding="utf-8")
        if not done.stdout.strip():
            raise AssertionError(f"the CLI printed nothing: {done.stderr}")
        return json.loads(done.stdout)

    def render(self, spec: dict[str, Any], tmp: Path, *extra: str) -> dict[str, Any]:
        path = tmp / "spec.json"
        path.write_text(json.dumps(spec), encoding="utf-8")
        return self.run("render", str(path), "--return", "svg,reading", *extra)

    def first_example(self, type_name: str) -> dict[str, Any]:
        return self.run("fixtures", "--type", type_name, "--kind", "example")["fixtures"][0]


@pytest.fixture(scope="session")
def cli() -> Cli:
    npx = shutil.which("npx")
    if npx is None:
        pytest.skip("Node (npx) is not installed, so the CLI output cannot be generated")
    if not (ROOT / "src/cli/index.ts").is_file() or not (ROOT / "node_modules/tsx").is_dir():
        pytest.skip("not a Boardplot repository checkout with `npm ci` done, so the CLI is not available")
    return Cli(npx)
