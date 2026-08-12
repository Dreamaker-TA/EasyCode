"""Boot the frozen EasyCode backend for the desktop application."""

from __future__ import annotations

import argparse
import os
import shutil
import sys
from pathlib import Path


def _arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="EasyCode desktop backend")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=32145)
    parser.add_argument("--data-dir", required=True)
    return parser.parse_args()


def _resource_root() -> Path:
    if getattr(sys, "frozen", False) and hasattr(sys, "_MEIPASS"):
        return Path(sys._MEIPASS).resolve()  # type: ignore[attr-defined]
    return Path(__file__).resolve().parents[1]


def _prepare_environment(args: argparse.Namespace, resource_root: Path) -> Path:
    user_root = Path(args.data_dir).expanduser().resolve()
    data_root = user_root / "data"
    data_root.mkdir(parents=True, exist_ok=True)

    os.environ["EASYCODE_RESOURCE_ROOT"] = str(resource_root)
    os.environ["EASYCODE_SETTINGS_PATH"] = str(user_root / "settings.env")
    os.environ["EASYCODE_PROBLEMS_JSON_PATH"] = str(data_root / "problems.json")
    os.environ["DB_PATH"] = str(data_root / "easycode.db")
    os.environ["APP_ENV"] = "production"
    os.environ["CORS_ORIGINS"] = ""
    os.environ["PYTHONUNBUFFERED"] = "1"
    return data_root


def _refresh_bundled_problem_index(resource_root: Path, data_root: Path) -> None:
    source = resource_root / "desktop" / "seed" / "problems.json"
    target = data_root / "problems.json"
    if not source.is_file():
        raise RuntimeError(f"Bundled problem index is missing: {source}")
    if not target.exists() or source.read_bytes() != target.read_bytes():
        shutil.copyfile(source, target)


def _migrate_and_seed(resource_root: Path) -> None:
    from alembic import command
    from alembic.config import Config

    config = Config(str(resource_root / "backend" / "alembic.ini"))
    config.set_main_option("script_location", str(resource_root / "backend" / "alembic"))
    command.upgrade(config, "head")

    from app.scripts.seed_from_json import main as seed_problems

    result = seed_problems()
    if result:
        raise RuntimeError(f"Problem seeding failed with exit code {result}")


def main() -> int:
    args = _arguments()
    resource_root = _resource_root()
    data_root = _prepare_environment(args, resource_root)
    _refresh_bundled_problem_index(resource_root, data_root)
    _migrate_and_seed(resource_root)

    import uvicorn

    uvicorn.run(
        "app.main:app",
        host=args.host,
        port=args.port,
        log_level="info",
        access_log=False,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
