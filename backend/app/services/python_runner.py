"""Server-side Python execution for final review grounding.

The browser runner is useful for fast feedback, but final persisted review
evidence must be computed by the backend so clients cannot forge verdicts.
This runner is intentionally small and deterministic: compile once in-process,
then execute each case in an isolated subprocess with a per-case timeout.
"""

from __future__ import annotations

import math
import subprocess
import sys
import tempfile
from dataclasses import dataclass

from app.schemas.testcase import TestSuite


@dataclass(frozen=True)
class RunnerFailure:
    id: str
    is_sample: bool
    status: str
    stdin: str | None = None
    expected: str | None = None
    actual: str | None = None
    stderr: str | None = None


_SEVERITY = {
    "OK": 0,
    "WRONG": 1,
    "TLE": 2,
    "RUNTIME_ERROR": 3,
    "COMPILE_ERROR": 4,
}
_OUTPUT_MAX_CHARS = 20_000


def run_python_suite(code: str, suite: TestSuite) -> dict:
    """Run ``code`` against ``suite`` and return the public RunResult shape."""

    total = len(suite.cases)
    compile_error = _compile_error(code)
    if compile_error:
        return {
            "verdict": "COMPILE_ERROR",
            "passed": 0,
            "total": total,
            "failures": [],
            "error": _clip(compile_error),
        }

    timeout_sec = max(0.1, suite.time_limit_ms / 1000)
    failures: list[RunnerFailure] = []
    passed = 0
    top_verdict = "OK"

    with tempfile.TemporaryDirectory(prefix="easycode-run-") as cwd:
        for case in suite.cases:
            try:
                completed = subprocess.run(
                    [sys.executable, "-I", "-X", "utf8", "-c", code],
                    input=case.stdin,
                    text=True,
                    capture_output=True,
                    timeout=timeout_sec,
                    check=False,
                    cwd=cwd,
                    env={"PYTHONIOENCODING": "utf-8", "PYTHONUTF8": "1"},
                )
            except subprocess.TimeoutExpired:
                failures.append(
                    _failure(
                        case.id,
                        case.is_sample,
                        "TLE",
                        stdin=case.stdin,
                        expected=case.expected_stdout,
                    )
                )
                top_verdict = _max_verdict(top_verdict, "TLE")
                continue

            if completed.returncode != 0:
                failures.append(
                    _failure(
                        case.id,
                        case.is_sample,
                        "RUNTIME_ERROR",
                        stdin=case.stdin,
                        expected=case.expected_stdout,
                        actual=_clip(completed.stdout),
                        stderr=_clip(completed.stderr),
                    )
                )
                top_verdict = _max_verdict(top_verdict, "RUNTIME_ERROR")
                continue

            if _output_matches(completed.stdout, case.expected_stdout, suite.checker):
                passed += 1
                continue

            failures.append(
                _failure(
                    case.id,
                    case.is_sample,
                    "WRONG",
                    stdin=case.stdin,
                    expected=case.expected_stdout,
                    actual=_clip(completed.stdout),
                )
            )
            top_verdict = _max_verdict(top_verdict, "WRONG")

    return {
        "verdict": top_verdict,
        "passed": passed,
        "total": total,
        "failures": [failure.__dict__ for failure in failures],
    }


def _compile_error(code: str) -> str:
    try:
        compile(code, "<user>", "exec")
    except SyntaxError as exc:
        return f"{type(exc).__name__}: {exc}"
    return ""


def _clip(value: str | None) -> str | None:
    if value is None:
        return None
    suffix = "...(truncated)"
    if len(value) <= _OUTPUT_MAX_CHARS:
        return value
    return value[: _OUTPUT_MAX_CHARS - len(suffix)] + suffix


def _failure(
    case_id: str,
    is_sample: bool,
    status: str,
    *,
    stdin: str,
    expected: str,
    actual: str | None = None,
    stderr: str | None = None,
) -> RunnerFailure:
    return RunnerFailure(
        id=case_id,
        is_sample=is_sample,
        status=status,
        stdin=stdin if is_sample else None,
        expected=expected if is_sample else None,
        actual=actual if is_sample else None,
        stderr=stderr if is_sample else None,
    )


def _max_verdict(current: str, candidate: str) -> str:
    return candidate if _SEVERITY[candidate] > _SEVERITY[current] else current


def _output_matches(actual: str, expected: str, checker: str) -> bool:
    if checker == "exact":
        return _strip_trailing_line_space(actual) == _strip_trailing_line_space(expected)
    if checker == "float":
        return _float_matches(actual, expected)
    return _normalize_tokens(actual) == _normalize_tokens(expected)


def _normalize_tokens(value: str) -> str:
    return " ".join(value.split())


def _strip_trailing_line_space(value: str) -> str:
    lines = [line.rstrip(" \t") for line in value.splitlines()]
    return "\n".join(lines).rstrip("\n")


def _float_matches(actual: str, expected: str) -> bool:
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
        if math.isnan(actual_float) != math.isnan(expected_float):
            return False
    return True
