"""Build hooks: take the version from the generated _version.py, and stop a
build that would ship without the engine or browser bundles."""

import re
from pathlib import Path

from hatchling.builders.hooks.plugin.interface import BuildHookInterface
from hatchling.metadata.plugin.interface import MetadataHookInterface

REQUIRED = (
    "src/boardplot/_assets/engine.js",
    "src/boardplot/_assets/runtime.js",
    "src/boardplot/_assets/widget.js",
    "src/boardplot/_assets/build.json",
    "src/boardplot/_version.py",
)


def _check(root: str) -> None:
    missing = [name for name in REQUIRED if not (Path(root) / name).is_file()]
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
