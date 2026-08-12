"""Build the native backend bundle consumed by Electron."""

from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DESKTOP = ROOT / "desktop"


def _run(command: list[str], *, env: dict[str, str] | None = None) -> None:
    print("+", " ".join(command), flush=True)
    subprocess.run(command, cwd=ROOT, env=env, check=True)


def main() -> int:
    frontend_dist = ROOT / "frontend" / "dist" / "index.html"
    if not frontend_dist.is_file():
        print("Frontend build is missing. Run `cd frontend && pnpm build` first.", file=sys.stderr)
        return 2

    build_dir = DESKTOP / "build"
    build_dir.mkdir(parents=True, exist_ok=True)
    problems_json = build_dir / "problems.json"
    env = os.environ.copy()
    env["EASYCODE_PROBLEMS_JSON_PATH"] = str(problems_json)
    env["PYTHONIOENCODING"] = "utf-8"
    env["PYTHONUTF8"] = "1"
    _run([sys.executable, str(ROOT / "scripts" / "ingest_problems.py")], env=env)

    _run(
        [
            sys.executable,
            "-m",
            "PyInstaller",
            "--clean",
            "--noconfirm",
            "--distpath",
            str(DESKTOP / "backend-dist"),
            "--workpath",
            str(DESKTOP / ".pyinstaller-build"),
            str(DESKTOP / "easycode_backend.spec"),
        ]
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
