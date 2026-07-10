#!/usr/bin/env python3
"""Create one EasyCode problem-bank entry from a single JSON spec.

The script writes the three files EasyCode expects:

* Code/.../<name>.md
* Code/.../<name>.tests.json
* Code/.../<name>.rubric.md

It validates the reference Python program against sample outputs, then runs the
same reference on hidden inputs to generate trusted expected_stdout values.
Default mode is dry-run; pass --write to touch the bank.
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path, PurePosixPath
from typing import Any

CHECKERS = {"token", "exact", "float"}
RUN_TIMEOUT_S = 8


@dataclass(frozen=True)
class CaseSeed:
    stdin: str
    expected: str | None
    note: str


def main() -> int:
    parser = argparse.ArgumentParser(
        description=(
            "Create an EasyCode Markdown problem, .tests.json sidecar, and "
            ".rubric.md sidecar from one JSON spec."
        )
    )
    parser.add_argument("--spec", required=True, help="Path to the JSON spec.")
    parser.add_argument(
        "--bank-root",
        required=True,
        help="Problem-bank root; the script writes under its Code/ directory.",
    )
    parser.add_argument("--write", action="store_true", help="Write files. Omitted = dry-run.")
    parser.add_argument("--force", action="store_true", help="Overwrite existing files.")
    args = parser.parse_args()

    try:
        spec = _load_spec(Path(args.spec))
        bank_root = _resolve_path(args.bank_root)
        paths = _entry_paths(bank_root, _required_str(spec, "source_path"))
        existing = _existing_paths(paths)
        if args.write:
            _ensure_no_existing(existing, force=args.force)

        checker = str(spec.get("checker", "token"))
        if checker not in CHECKERS:
            raise ValueError(f"checker must be one of {sorted(CHECKERS)}")

        template = _strip_code_fence(_required_str(spec, "template"))
        reference = _strip_code_fence(_required_str(spec, "reference"))
        samples = _parse_samples(spec.get("samples"))
        hidden = _parse_hidden(spec.get("hidden", []))
        _validate_case_shape(samples, hidden)
        _validate_resource_limits(spec)

        cases = _build_cases(
            reference=reference,
            checker=checker,
            samples=samples,
            hidden=hidden,
        )
        files = {
            paths.md: _build_markdown(spec, reference),
            paths.tests: _build_tests_json(spec, checker, template, cases),
            paths.rubric: _build_rubric(spec.get("rubric", [])),
        }

        _print_summary(bank_root, files, existing=existing, write=args.write, force=args.force)
        if args.write:
            for path, content in files.items():
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(content, encoding="utf-8")
            print("\nWrote problem entry.")
        else:
            print("\nDry run only. Re-run with --write to create files.")
        print(f"Next: EASYCODE_PROBLEM_BANK_ROOT={bank_root} make ingest")
        return 0
    except Exception as exc:  # noqa: BLE001 - command-line UX should be explicit.
        print(f"error: {exc}", file=sys.stderr)
        return 1


def _load_spec(path: Path) -> dict[str, Any]:
    data = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        raise ValueError("spec must be a JSON object")
    return data


def _resolve_path(value: str) -> Path:
    return Path(value).expanduser().resolve()


@dataclass(frozen=True)
class EntryPaths:
    md: Path
    tests: Path
    rubric: Path


def _entry_paths(bank_root: Path, source_path: str) -> EntryPaths:
    pure = PurePosixPath(source_path)
    if pure.is_absolute() or ".." in pure.parts:
        raise ValueError("source_path must be a safe relative path under Code/")
    if len(pure.parts) < 3 or pure.parts[0] != "Code":
        raise ValueError("source_path must look like Code/<chapter>/<file>.md")
    if pure.name.endswith(".rubric.md") or pure.suffix != ".md":
        raise ValueError("source_path must point to a problem .md file, not a sidecar")
    root = bank_root.resolve()
    md = root.joinpath(*pure.parts)
    if not md.resolve(strict=False).is_relative_to(root):
        raise ValueError("source_path resolves outside the problem-bank root")
    return EntryPaths(
        md=md,
        tests=md.with_suffix(".tests.json"),
        rubric=md.with_suffix(".rubric.md"),
    )


def _existing_paths(paths: EntryPaths) -> list[Path]:
    return [path for path in (paths.md, paths.tests, paths.rubric) if path.exists()]


def _ensure_no_existing(existing: list[Path], *, force: bool) -> None:
    if force:
        return
    if existing:
        raise FileExistsError(
            "refusing to overwrite existing files without --force:\n  "
            + "\n  ".join(str(path) for path in existing)
        )


def _required_str(spec: dict[str, Any], key: str) -> str:
    value = spec.get(key)
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{key!r} must be a non-empty string")
    return value


def _optional_str(spec: dict[str, Any], key: str, default: str = "") -> str:
    value = spec.get(key, default)
    if value is None:
        return default
    if not isinstance(value, str):
        raise ValueError(f"{key!r} must be a string when provided")
    return value.strip()


def _parse_samples(raw: Any) -> list[CaseSeed]:
    if not isinstance(raw, list) or not raw:
        raise ValueError("samples must be a non-empty list")
    out: list[CaseSeed] = []
    for idx, item in enumerate(raw, start=1):
        if not isinstance(item, dict):
            raise ValueError(f"samples[{idx}] must be an object")
        stdin = item.get("stdin")
        expected = item.get("expected")
        if not isinstance(stdin, str) or not isinstance(expected, str):
            raise ValueError(f"samples[{idx}] must include string stdin and expected")
        note = item.get("note", f"sample {idx}")
        if not isinstance(note, str):
            raise ValueError(f"samples[{idx}].note must be a string when provided")
        out.append(CaseSeed(stdin=stdin, expected=expected, note=note))
    return out


def _parse_hidden(raw: Any) -> list[CaseSeed]:
    if raw is None:
        return []
    if not isinstance(raw, list):
        raise ValueError("hidden must be a list")
    out: list[CaseSeed] = []
    for idx, item in enumerate(raw, start=1):
        if isinstance(item, str):
            out.append(CaseSeed(stdin=item, expected=None, note=""))
            continue
        if not isinstance(item, dict):
            raise ValueError(f"hidden[{idx}] must be a string or object")
        stdin = item.get("stdin")
        if not isinstance(stdin, str):
            raise ValueError(f"hidden[{idx}] must include string stdin")
        note = item.get("note", "")
        if not isinstance(note, str):
            raise ValueError(f"hidden[{idx}].note must be a string when provided")
        out.append(CaseSeed(stdin=stdin, expected=None, note=note))
    return out


def _validate_case_shape(samples: list[CaseSeed], hidden: list[CaseSeed]) -> None:
    if len(samples) < 2:
        raise ValueError("samples must contain at least 2 cases")
    if len(hidden) < 3:
        raise ValueError("hidden must contain at least 3 cases")
    inputs = [case.stdin for case in (*samples, *hidden)]
    if len(inputs) != len(set(inputs)):
        raise ValueError("sample and hidden stdin values must be unique")


def _validate_resource_limits(spec: dict[str, Any]) -> None:
    time_limit_ms = int(spec.get("time_limit_ms", 1000))
    memory_limit_mb = int(spec.get("memory_limit_mb", 256))
    if time_limit_ms <= 0:
        raise ValueError("time_limit_ms must be a positive integer")
    if memory_limit_mb <= 0:
        raise ValueError("memory_limit_mb must be a positive integer")


def _build_cases(
    *,
    reference: str,
    checker: str,
    samples: list[CaseSeed],
    hidden: list[CaseSeed],
) -> list[dict[str, Any]]:
    cases: list[dict[str, Any]] = []
    for idx, sample in enumerate(samples, start=1):
        stdout = _run_reference(reference, sample.stdin)
        assert sample.expected is not None
        if not _checker_match(stdout, sample.expected, checker):
            raise ValueError(
                f"sample-{idx} mismatch: expected {sample.expected!r}, got {stdout!r}"
            )
        cases.append(
            {
                "id": f"sample-{idx}",
                "is_sample": True,
                "stdin": sample.stdin,
                "expected_stdout": stdout,
                "note": sample.note,
            }
        )
    for idx, case in enumerate(hidden, start=1):
        stdout = _run_reference(reference, case.stdin)
        cases.append(
            {
                "id": f"hidden-{idx}",
                "is_sample": False,
                "stdin": case.stdin,
                "expected_stdout": stdout,
                "note": case.note,
            }
        )
    return cases


def _run_reference(program: str, stdin: str) -> str:
    try:
        proc = subprocess.run(
            [sys.executable, "-I", "-X", "utf8", "-c", program],
            input=stdin,
            capture_output=True,
            text=True,
            timeout=RUN_TIMEOUT_S,
            check=False,
            env={"PYTHONIOENCODING": "utf-8", "PYTHONUTF8": "1"},
        )
    except subprocess.TimeoutExpired as exc:
        raise TimeoutError("reference solution timed out") from exc
    if proc.returncode != 0:
        raise RuntimeError(f"reference solution failed: {proc.stderr.strip()[:500]}")
    return proc.stdout


def _checker_match(actual: str, expected: str, checker: str) -> bool:
    if checker == "exact":
        return _norm_exact(actual) == _norm_exact(expected)
    if checker == "float":
        return _float_match(actual, expected)
    return _norm_tokens(actual) == _norm_tokens(expected)


def _norm_tokens(value: str) -> str:
    return " ".join(value.split())


def _norm_exact(value: str) -> str:
    lines = [line.rstrip(" \t") for line in value.split("\n")]
    return "\n".join(lines).rstrip("\n")


def _float_match(actual: str, expected: str) -> bool:
    actual_tokens = actual.split()
    expected_tokens = expected.split()
    if len(actual_tokens) != len(expected_tokens):
        return False
    tolerance = 1e-6
    for actual_token, expected_token in zip(actual_tokens, expected_tokens):
        try:
            actual_float = float(actual_token)
            expected_float = float(expected_token)
        except ValueError:
            if actual_token != expected_token:
                return False
            continue
        diff = abs(actual_float - expected_float)
        if diff > tolerance and diff > tolerance * abs(expected_float):
            return False
    return True


def _build_markdown(spec: dict[str, Any], reference: str) -> str:
    heading = _optional_str(spec, "heading")
    if not heading:
        title = _required_str(spec, "title")
        problem_id = spec.get("id", spec.get("leetcode_id"))
        core = bool(spec.get("core", False))
        suffix = " ★" if core else ""
        heading = f"{problem_id}. {title}{suffix}" if problem_id else f"{title}{suffix}"

    statement = _demote_h2_headings(
        _strip_section_heading(_required_str(spec, "statement_md"), "题目描述")
    )
    explanation = _strip_section_heading(_optional_str(spec, "explanation_md"), "解题思路")
    if not explanation:
        explanation = "参考解使用题目约束内的直接模拟或数据结构维护，保证结果可复现。"

    return (
        f"# {heading.strip().lstrip('#').strip()}\n\n"
        "## 题目描述\n\n"
        f"{statement.strip()}\n\n"
        "## 解题思路\n\n"
        f"{explanation.strip()}\n\n"
        "## Python 代码\n\n"
        "```python\n"
        f"{reference.rstrip()}\n"
        "```\n"
    )


def _strip_section_heading(value: str, heading: str) -> str:
    lines = value.strip().splitlines()
    if lines and lines[0].strip() == f"## {heading}":
        return "\n".join(lines[1:]).strip()
    return value.strip()


def _demote_h2_headings(value: str) -> str:
    """Keep statement subsections inside the public statement parser boundary."""
    return "\n".join(
        f"#{line}" if line.startswith("## ") else line for line in value.splitlines()
    )


def _strip_code_fence(value: str) -> str:
    lines = value.strip().splitlines()
    if not lines or not lines[0].strip().startswith("```"):
        return value.strip()
    if lines[-1].strip() == "```":
        lines = lines[1:-1]
    else:
        lines = lines[1:]
    return "\n".join(lines).strip()


def _build_tests_json(
    spec: dict[str, Any],
    checker: str,
    template: str,
    cases: list[dict[str, Any]],
) -> str:
    payload = {
        "version": 1,
        "time_limit_ms": int(spec.get("time_limit_ms", 1000)),
        "memory_limit_mb": int(spec.get("memory_limit_mb", 256)),
        "checker": checker,
        "cases": cases,
        "templates": {"python": template},
    }
    return json.dumps(payload, ensure_ascii=False, indent=2) + "\n"


def _build_rubric(raw: Any) -> str:
    if isinstance(raw, str):
        text = raw.strip()
        return text + ("\n" if text else "")
    if not isinstance(raw, list) or not raw:
        return (
            "- Correctly implements the required input/output behavior.\n"
            "- Handles sample and hidden edge cases without extra prompts.\n"
            "- Uses an approach that fits the stated constraints.\n"
        )
    if not 3 <= len(raw) <= 6:
        raise ValueError("rubric must contain 3 to 6 items")
    lines: list[str] = []
    for idx, item in enumerate(raw, start=1):
        if not isinstance(item, str) or not item.strip():
            raise ValueError(f"rubric[{idx}] must be a non-empty string")
        text = item.strip()
        lines.append(text if text.startswith("- ") else f"- {text}")
    return "\n".join(lines) + "\n"


def _print_summary(
    bank_root: Path,
    files: dict[Path, str],
    *,
    existing: list[Path],
    write: bool,
    force: bool,
) -> None:
    mode = "write" if write else "dry-run"
    print(f"Mode: {mode}{' (force)' if force else ''}")
    print(f"Bank: {bank_root}")
    for path, content in files.items():
        rel = path.relative_to(bank_root)
        size = len(content.encode("utf-8"))
        print(f"  - {rel} ({size} bytes)")
    if existing and not write:
        print("Existing files detected; dry-run did not modify them:")
        for path in existing:
            print(f"  - {path.relative_to(bank_root)}")


if __name__ == "__main__":
    raise SystemExit(main())
