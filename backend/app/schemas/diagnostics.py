"""Diagnostics API schema.

The endpoint exposes only operational state. It must never return raw secrets.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel


DiagnosticStatus = Literal["ok", "warn", "error"]


class DiagnosticCheck(BaseModel):
    label: str
    status: DiagnosticStatus
    message: str
    recovery: str | None = None


class RuntimeDiagnostics(BaseModel):
    version: str
    backend_ok: bool
    database_ok: bool
    database_path: str
    database_size_bytes: int | None
    cors_origins: list[str]
    api_base_hint: str
    checks: list[DiagnosticCheck]


class ReviewDiagnostics(BaseModel):
    mode: Literal["llm"]
    llm_key_configured: bool
    llm_base_url: str
    llm_model: str
    llm_provider: str
    pending_review_count: int
    stale_review_count: int
    review_stale_after_sec: int
    oldest_review_started_at: str | None
    checks: list[DiagnosticCheck]


class ExecutionDiagnostics(BaseModel):
    executor: Literal["pyodide", "none"]
    pyodide_assets_present: bool
    testcase_problem_count: int
    checks: list[DiagnosticCheck]


class ImportErrorSummary(BaseModel):
    source: str
    message: str


class ProblemsDiagnostics(BaseModel):
    source_path: str
    source_files: int
    parsed_count: int
    seeded_count: int
    rubric_problem_count: int
    last_generated_at: str | None
    last_seeded_at: str | None
    errors: list[ImportErrorSummary]
    checks: list[DiagnosticCheck]


class DiagnosticsResponse(BaseModel):
    generated_at: str
    runtime: RuntimeDiagnostics
    review: ReviewDiagnostics
    execution: ExecutionDiagnostics
    problems: ProblemsDiagnostics
