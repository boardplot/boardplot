"""Build hooks: take the version from the generated _version.py, and stop a
build that would ship without the engine or browser bundles, or without the
Streamlit component manifest and its one bundle."""

import re
from glob import glob
from pathlib import Path

from hatchling.builders.hooks.plugin.interface import BuildHookInterface
from hatchling.metadata.plugin.interface import MetadataHookInterface

REQUIRED = (
    "src/boardplot/_assets/engine.js",
    "src/boardplot/_assets/runtime.js",
    "src/boardplot/_assets/widget.js",
    "src/boardplot/_assets/build.json",
    "src/boardplot/_version.py",
    "src/boardplot/pyproject.toml",
)
# Streamlit's component glob must match exactly one bundle.
STREAMLIT_BUNDLE = "src/boardplot/_assets/streamlit/boardplot-*.js"


def _check(root: str) -> None:
    missing = [name for name in REQUIRED if not (Path(root) / name).is_file()]
    if len(glob(str(Path(root) / STREAMLIT_BUNDLE))) != 1:
        missing.append(f"exactly one {STREAMLIT_BUNDLE}")
    if missing:
        raise RuntimeError(
            f"boardplot: {', '.join(missing)} missing; run `node python/js/build.mjs` "
            "from the repository root first (needs Node 22 and `npm ci`)."
        )


class CustomMetadataHook(MetadataHookInterface):
    def update(self, metadata):
        _check(self.root)
        text = (Path(self.root) / "src/boardplot/_version.py").read_text(encoding="utf-8")
        match = re.search(r'^__version__ = "([^"]+)"$', text, re.MULTILINE)
        if not match:
            raise RuntimeError("boardplot: src/boardplot/_version.py has no __version__; rerun `node python/js/build.mjs`.")
        metadata["version"] = match.group(1)


class CustomBuildHook(BuildHookInterface):
    def initialize(self, version, build_data):
        _check(self.root)
