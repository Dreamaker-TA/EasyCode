"""Fail when user-visible release versions drift apart."""

from __future__ import annotations

import json
import re
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def main() -> int:
    expected = (ROOT / "VERSION").read_text(encoding="utf-8").strip()
    values = {
        "desktop/package.json": json.loads(
            (ROOT / "desktop" / "package.json").read_text(encoding="utf-8")
        )["version"],
        "frontend/package.json": json.loads(
            (ROOT / "frontend" / "package.json").read_text(encoding="utf-8")
        )["version"],
        "backend/pyproject.toml": _match(
            ROOT / "backend" / "pyproject.toml", r'^version = "([^"]+)"$'
        ),
        "backend/app/version.py": _match(
            ROOT / "backend" / "app" / "version.py", r'^VERSION = "([^"]+)"$'
        ),
    }
    drift = {path: value for path, value in values.items() if value != expected}
    if drift:
        for path, value in drift.items():
            print(f"version mismatch: {path} has {value}, expected {expected}")
        return 1
    print(f"Release version check: {expected} across {len(values) + 1} sources")
    return 0


def _match(path: Path, pattern: str) -> str:
    match = re.search(pattern, path.read_text(encoding="utf-8"), flags=re.MULTILINE)
    if not match:
        raise RuntimeError(f"Version not found in {path}")
    return match.group(1)


if __name__ == "__main__":
    raise SystemExit(main())
