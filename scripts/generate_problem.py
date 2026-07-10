#!/usr/bin/env python3
"""Generate, validate, and optionally write one EasyCode problem with an LLM."""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
import tempfile
from pathlib import Path, PurePosixPath
from typing import Any

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "backend"))

from app.services.llm_client import (  # noqa: E402
    LLMClient,
    LLMOutputInvalid,
    LLMUnavailable,
    get_client,
)

REQUIRED_KEYS = {
    "source_path",
    "id",
    "title",
    "core",
    "statement_md",
    "explanation_md",
    "template",
    "reference",
    "checker",
    "time_limit_ms",
    "memory_limit_mb",
    "samples",
    "hidden",
    "rubric",
}

PROBLEM_SCHEMA: dict[str, Any] = {
    "title": "easycode_problem_spec",
    "type": "object",
    "additionalProperties": False,
    "required": sorted(REQUIRED_KEYS),
    "properties": {
        "source_path": {"type": "string", "pattern": r"^Code/[^/]+/[^/]+\.md$"},
        "id": {"type": "integer", "minimum": 1},
        "title": {"type": "string", "minLength": 1},
        "core": {"type": "boolean"},
        "statement_md": {"type": "string", "minLength": 1},
        "explanation_md": {"type": "string", "minLength": 1},
        "template": {"type": "string", "minLength": 1},
        "reference": {"type": "string", "minLength": 1},
        "checker": {"type": "string", "enum": ["token", "exact", "float"]},
        "time_limit_ms": {"type": "integer", "minimum": 1},
        "memory_limit_mb": {"type": "integer", "minimum": 1},
        "samples": {
            "type": "array",
            "minItems": 2,
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["stdin", "expected", "note"],
                "properties": {
                    "stdin": {"type": "string"},
                    "expected": {"type": "string"},
                    "note": {"type": "string"},
                },
            },
        },
        "hidden": {
            "type": "array",
            "minItems": 4,
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["stdin", "note"],
                "properties": {
                    "stdin": {"type": "string"},
                    "note": {"type": "string"},
                },
            },
        },
        "rubric": {
            "type": "array",
            "minItems": 3,
            "maxItems": 6,
            "items": {"type": "string", "minLength": 1},
        },
    },
}

SYSTEM_PROMPT = """You create original programming exercises for EasyCode.
Return exactly one JSON object that follows the supplied schema. Do not use
Markdown fences or add prose outside the JSON. The programs must run on Python
3.11 using stdin and stdout only."""


def main(argv: list[str] | None = None, *, client: LLMClient | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Generate one EasyCode problem with the configured LLM, then validate it locally."
    )
    parser.add_argument("--bank-root", required=True, help="Problem-bank root containing Code/.")
    source = parser.add_mutually_exclusive_group()
    source.add_argument("--request", help="One-line exercise description.")
    source.add_argument("--request-file", help="UTF-8 file containing the exercise description.")
    parser.add_argument("--spec-out", help="Optionally keep the generated JSON spec at this path.")
    parser.add_argument("--write", action="store_true", help="Write the three problem-bank files.")
    parser.add_argument("--yes", action="store_true", help="Skip the write confirmation.")
    args = parser.parse_args(argv)

    try:
        request = _read_request(args.request, args.request_file)
        llm = client or get_client()
        spec = llm.chat_json(
            system=SYSTEM_PROMPT,
            user=_build_user_prompt(request),
            temperature=0.2,
            max_tokens=6000,
            schema=PROBLEM_SCHEMA,
        )
        _validate_spec_shape(spec)
        _ensure_destinations_available(Path(args.bank_root), str(spec["source_path"]))

        if args.spec_out:
            _write_spec(Path(args.spec_out), spec)

        with tempfile.TemporaryDirectory(prefix="easycode-problem-") as tmp:
            spec_path = Path(tmp) / "problem.json"
            spec_path.write_text(
                json.dumps(spec, ensure_ascii=False, indent=2) + "\n",
                encoding="utf-8",
            )
            _run_entry_builder(args.bank_root, spec_path, write=False)

            if not args.write:
                print("\nValidation passed. Re-run with --write to create the files.")
                return 0
            if not args.yes and not _confirm_write():
                print("\nCancelled; no problem-bank files were written.")
                return 0
            _run_entry_builder(args.bank_root, spec_path, write=True)
        return 0
    except (LLMUnavailable, LLMOutputInvalid) as exc:
        print(f"error: LLM request failed: {exc}", file=sys.stderr)
        return 1
    except Exception as exc:  # noqa: BLE001 - CLI should return one actionable error.
        print(f"error: {exc}", file=sys.stderr)
        return 1


def _read_request(request: str | None, request_file: str | None) -> str:
    if request_file:
        value = Path(request_file).expanduser().read_text(encoding="utf-8")
    elif request is not None:
        value = request
    elif sys.stdin.isatty():
        value = input("Describe the exercise to create: ")
    else:
        value = sys.stdin.read()
    value = value.strip()
    if not value:
        raise ValueError("exercise description is empty")
    return value


def _build_user_prompt(request: str) -> str:
    return f"""Create one EasyCode problem from this request:

{request}

Requirements:
- Return exactly these keys: source_path, id, title, core, statement_md,
  explanation_md, template, reference, checker, time_limit_ms,
  memory_limit_mb, samples, hidden, rubric.
- Write an original statement. Do not reproduce a known platform's wording.
- Match the natural language used in the request.
- Choose a stable positive numeric id and a safe path shaped like
  Code/<chapter>/<order>_<id>_<ascii-or-unicode-slug>.md unless the request gives them.
- statement_md must contain the public statement, input/output format, examples,
  and constraints. Use ### headings inside it, never ## headings.
- template and reference must be complete runnable Python programs without code fences.
- The starter template must be clearly unfinished but must not contain a TODO marker.
- Use checker=token unless exact formatting or floating-point comparison is required.
- samples must contain at least 2 objects with string stdin, expected, and note fields.
- hidden must contain at least 4 objects with distinct string stdin and note fields.
- The reference program must produce every sample expected value.
- Include 3 to 6 concise grading bullets as plain strings.
"""


def _validate_spec_shape(spec: dict[str, Any]) -> None:
    if not isinstance(spec, dict):
        raise ValueError("LLM output must be a JSON object")
    missing = sorted(REQUIRED_KEYS - set(spec))
    extra = sorted(set(spec) - REQUIRED_KEYS)
    if missing:
        raise ValueError(f"LLM output is missing required keys: {', '.join(missing)}")
    if extra:
        raise ValueError(f"LLM output contains unsupported keys: {', '.join(extra)}")
    if not isinstance(spec["samples"], list) or len(spec["samples"]) < 2:
        raise ValueError("LLM output must contain at least 2 samples")
    if not isinstance(spec["hidden"], list) or len(spec["hidden"]) < 4:
        raise ValueError("LLM output must contain at least 4 hidden cases")
    if not isinstance(spec["rubric"], list) or not 3 <= len(spec["rubric"]) <= 6:
        raise ValueError("LLM output rubric must contain 3 to 6 items")


def _write_spec(path: Path, spec: dict[str, Any]) -> None:
    destination = path.expanduser().resolve()
    if destination.exists():
        raise FileExistsError(f"refusing to overwrite existing spec: {destination}")
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(
        json.dumps(spec, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(f"Saved generated spec: {destination}")


def _ensure_destinations_available(bank_root: Path, source_path: str) -> None:
    rel = PurePosixPath(source_path)
    if rel.is_absolute() or ".." in rel.parts or len(rel.parts) < 3 or rel.parts[0] != "Code":
        raise ValueError("generated source_path must look like Code/<chapter>/<file>.md")
    markdown = bank_root.expanduser().resolve().joinpath(*rel.parts)
    existing = [
        path
        for path in (
            markdown,
            markdown.with_suffix(".tests.json"),
            markdown.with_suffix(".rubric.md"),
        )
        if path.exists()
    ]
    if existing:
        rendered = "\n  ".join(str(path) for path in existing)
        raise FileExistsError(f"generated problem would overwrite existing files:\n  {rendered}")


def _run_entry_builder(bank_root: str, spec_path: Path, *, write: bool) -> None:
    command = [
        sys.executable,
        str(Path(__file__).with_name("create_problem_entry.py")),
        "--bank-root",
        bank_root,
        "--spec",
        str(spec_path),
    ]
    if write:
        command.append("--write")
    completed = subprocess.run(command, check=False)
    if completed.returncode != 0:
        mode = "write" if write else "validation"
        raise RuntimeError(f"local problem {mode} failed")


def _confirm_write() -> bool:
    if not sys.stdin.isatty():
        raise ValueError("--yes is required with --write in non-interactive mode")
    answer = input("\nWrite these files to the problem bank? [y/N] ").strip().lower()
    return answer in {"y", "yes"}


if __name__ == "__main__":
    raise SystemExit(main())
