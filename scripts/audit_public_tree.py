#!/usr/bin/env python3
"""Fail when the publishable Git tree contains private or release-only material."""

from __future__ import annotations

import re
import subprocess
import sys
from pathlib import Path, PurePosixPath

ROOT = Path(__file__).resolve().parent.parent
SELF = PurePosixPath("scripts/audit_public_tree.py")

ALLOWED_MARKDOWN = {
    PurePosixPath("README.md"),
    PurePosixPath("README.zh.md"),
    PurePosixPath("PROBLEM_BANK_FORMAT.md"),
    PurePosixPath("examples/problem-bank/README.md"),
    PurePosixPath("frontend/public/ASSETS.md"),
}
ALLOWED_MARKDOWN_PREFIXES = (
    PurePosixPath(".agents/skills"),
    PurePosixPath(".claude/skills"),
    PurePosixPath("backend/app/services/prompts"),
    PurePosixPath("examples/problem-bank/Code"),
)
BLOCKED_PARTS = {
    ".claude",
    ".codex",
    ".cursor",
    ".idea",
    ".vscode",
    ".venv",
    "__pycache__",
    "_screenshots",
    "archive",
    "coverage",
    "dist",
    "docs",
    "evals",
    "htmlcov",
    "node_modules",
    "reports",
    "site",
    "tests",
}
BLOCKED_SUFFIXES = {
    ".bak",
    ".db",
    ".doc",
    ".docx",
    ".key",
    ".log",
    ".orig",
    ".p12",
    ".pdf",
    ".pem",
    ".pfx",
    ".ppt",
    ".pptx",
    ".rej",
    ".sqlite",
    ".sqlite3",
    ".swp",
    ".tmp",
    ".xls",
    ".xlsx",
}
ALLOWED_SECRET_MARKERS = (
    "sk-xxx",
    "sk-or-xxx",
    "sk-your-real-key-here",
    "sk-test-secret-do-not-leak",
)
SECRET_PATTERNS = (
    ("private key", re.compile(r"-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----")),
    ("AWS access key", re.compile(r"\b(?:AKIA|ASIA)[0-9A-Z]{16}\b")),
    ("GitHub token", re.compile(r"\b(?:gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,})\b")),
    ("Slack token", re.compile(r"\bxox[baprs]-[A-Za-z0-9-]{20,}\b")),
    ("API key", re.compile(r"\bsk-[A-Za-z0-9_-]{16,}\b")),
    ("personal macOS path", re.compile(r"/" + r"Users/[A-Za-z0-9._-]+/")),
    ("personal Linux path", re.compile(r"/home/[A-Za-z0-9._-]+/")),
)


def main() -> int:
    errors: list[str] = []
    candidates = _publishable_files()
    if not candidates:
        errors.append("Git publishable tree is empty")

    for rel in candidates:
        path = ROOT.joinpath(*rel.parts)
        _check_path(rel, path, errors)
        if rel != SELF:
            _scan_text(rel, path, errors)

    _check_problem_bank(candidates, errors)
    _check_required_files(candidates, errors)

    commits = _git_commit_count()
    print(f"Publishable files: {len(candidates)}")
    print(f"Git history commits: {commits}")
    print("Example problems: 1 expected")
    if errors:
        print(f"Public-tree audit failed with {len(errors)} issue(s):", file=sys.stderr)
        for error in errors:
            print(f"  - {error}", file=sys.stderr)
        return 1
    print("Public-tree audit passed: no blocked files, private paths, or high-confidence secrets found.")
    return 0


def _publishable_files() -> list[PurePosixPath]:
    completed = subprocess.run(
        ["git", "ls-files", "--cached", "--others", "--exclude-standard", "-z"],
        cwd=ROOT,
        check=True,
        capture_output=True,
    )
    return sorted(
        PurePosixPath(raw.decode("utf-8"))
        for raw in completed.stdout.split(b"\0")
        if raw
    )


def _check_path(rel: PurePosixPath, path: Path, errors: list[str]) -> None:
    if path.is_symlink():
        errors.append(f"symlink requires manual review: {rel}")
    if rel.name == ".DS_Store" or rel.name.startswith(".env") and rel.name != ".env.example":
        errors.append(f"private environment or OS file: {rel}")
    if rel.suffix.lower() in BLOCKED_SUFFIXES:
        errors.append(f"blocked generated/private file type: {rel}")
    if any(part in BLOCKED_PARTS for part in rel.parts) and not _is_project_skill(rel):
        errors.append(f"blocked development/private path: {rel}")
    if _is_development_test_file(rel.name):
        errors.append(f"blocked development test file: {rel}")
    if rel.suffix.lower() == ".md" and not _markdown_allowed(rel):
        errors.append(f"undocumented Markdown file requires release review: {rel}")
    if rel.parts and rel.parts[0] == "Code":
        errors.append(f"private problem bank must not be published: {rel}")


def _is_development_test_file(name: str) -> bool:
    lower = name.lower()
    stem = lower.rsplit(".", 1)[0]
    return (
        lower == "conftest.py"
        or lower.startswith("test_")
        or stem.endswith("_test")
        or ".test." in lower
        or ".spec." in lower
    )


def _markdown_allowed(rel: PurePosixPath) -> bool:
    if rel in ALLOWED_MARKDOWN:
        return True
    return any(rel.is_relative_to(prefix) for prefix in ALLOWED_MARKDOWN_PREFIXES)


def _is_project_skill(rel: PurePosixPath) -> bool:
    return rel.is_relative_to(PurePosixPath(".agents/skills")) or rel.is_relative_to(
        PurePosixPath(".claude/skills")
    )


def _scan_text(rel: PurePosixPath, path: Path, errors: list[str]) -> None:
    try:
        if path.stat().st_size > 2_000_000:
            return
        text = path.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError):
        return
    for line_number, line in enumerate(text.splitlines(), start=1):
        if any(marker in line for marker in ALLOWED_SECRET_MARKERS):
            continue
        for label, pattern in SECRET_PATTERNS:
            if pattern.search(line):
                errors.append(f"possible {label}: {rel}:{line_number}")


def _check_problem_bank(candidates: list[PurePosixPath], errors: list[str]) -> None:
    problems = [
        rel
        for rel in candidates
        if rel.is_relative_to(PurePosixPath("examples/problem-bank/Code"))
        and rel.suffix == ".md"
        and not rel.name.endswith(".rubric.md")
    ]
    if len(problems) != 1:
        errors.append(f"expected exactly one example problem, found {len(problems)}")
        return
    problem = problems[0]
    stem = problem.as_posix()[:-3]
    expected = {
        PurePosixPath(f"{stem}.tests.json"),
        PurePosixPath(f"{stem}.rubric.md"),
    }
    missing = sorted(expected - set(candidates))
    for rel in missing:
        errors.append(f"example problem sidecar is missing: {rel}")


def _check_required_files(candidates: list[PurePosixPath], errors: list[str]) -> None:
    required = {
        PurePosixPath(".env.example"),
        PurePosixPath(".gitignore"),
        PurePosixPath("LICENSE"),
        PurePosixPath("README.md"),
        PurePosixPath("README.zh.md"),
        PurePosixPath("frontend/public/ASSETS.md"),
        PurePosixPath("frontend/public/share-card-bg-generated.jpg"),
    }
    for rel in sorted(required - set(candidates)):
        errors.append(f"required release file is missing: {rel}")


def _git_commit_count() -> int:
    completed = subprocess.run(
        ["git", "rev-list", "--all", "--count"],
        cwd=ROOT,
        check=False,
        capture_output=True,
        text=True,
    )
    if completed.returncode != 0:
        return 0
    value = completed.stdout.strip()
    return int(value) if value else 0


if __name__ == "__main__":
    raise SystemExit(main())
