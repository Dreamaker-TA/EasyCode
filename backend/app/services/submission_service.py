"""提交 / 快照的服务层。"""

from __future__ import annotations

import hashlib
import logging
import uuid
from datetime import datetime, timedelta, timezone
from typing import Literal

from sqlalchemy import func, select
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.orm import Session

from app.db.session import SessionLocal
from app.models import (
    Mastery,
    Problem,
    ReviewSchedule,
    Snapshot,
    Submission,
)
from app.services.python_runner import run_python_suite
from app.services.problem_service import supported_languages
from app.services import review_progress, testcase_loader

REVIEW_STALE_AFTER = timedelta(minutes=15)
REVIEW_INTERRUPTED_CODE = "REVIEW_INTERRUPTED"
REVIEW_INTERRUPTED_MESSAGE = (
    "评测后台任务在完成前中断。代码和过程记录已保留，可以重试评测。"
)
_RUN_VERDICTS = {"OK", "WRONG", "RUNTIME_ERROR", "COMPILE_ERROR", "TLE"}
_FAILURE_SEVERITY = {"WRONG": 1, "TLE": 2, "RUNTIME_ERROR": 3}
log = logging.getLogger(__name__)


class TestResultsContractError(ValueError):
    """提交执行证据与题目测试边车不一致。"""

    def __init__(self, code: str, message: str, *, status_code: int = 422) -> None:
        super().__init__(message)
        self.code = code
        self.status_code = status_code


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _ensure_aware(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value


def _review_clock(sub: Submission) -> datetime | None:
    return _ensure_aware(sub.review_started_at or sub.submitted_at or sub.created_at)


def _begin_review_attempt(sub: Submission, *, now: datetime | None = None) -> None:
    ts = now or _now()
    sub.status = "reviewing"
    sub.reviewed_at = None
    sub.review_started_at = ts
    sub.review_attempts = int(sub.review_attempts or 0) + 1
    sub.review_last_error_code = None


def _is_stale_review(sub: Submission, *, now: datetime, stale_after: timedelta) -> bool:
    if sub.status != "reviewing" or sub.reviewed_at is not None:
        return False
    started_at = _review_clock(sub)
    return started_at is not None and started_at <= now - stale_after


def _interrupted_review_payload(sub: Submission) -> dict:
    from app.services import llm_review

    review = {
        "can_compile": False,
        "compile_issues": [],
        "quality": {"score": 0, "comments": "评测未完成，无法判断代码质量。"},
        "complexity": {"time": "?", "space": "?", "explain": ""},
        "optimization": [],
        "process_review": REVIEW_INTERRUPTED_MESSAGE,
        "rating": None,
        "rating_rationale": "后台评测中断，未生成评分。",
        "error_code": REVIEW_INTERRUPTED_CODE,
        "error": REVIEW_INTERRUPTED_MESSAGE,
    }
    return llm_review.ensure_review_meta(
        review,
        sub.test_results_json,
        review_mode="interrupted",
        model=None,
    )


def _top_failure_verdict(failures: list[dict]) -> str | None:
    if not failures:
        return None
    return max(
        (str(f.get("status")) for f in failures),
        key=lambda status: _FAILURE_SEVERITY.get(status, -1),
    )


def _validate_test_results_contract(db: Session, sub: Submission, test_results: dict | None) -> None:
    """Verify client execution evidence against the problem's loaded test suite.

    Client-side Pyodide is only a fast feedback path. When a client sends those
    results, validate the protocol shape before comparing it with the backend's
    own execution result.
    """
    if test_results is None:
        return

    problem = db.get(Problem, sub.problem_id)
    if problem is None:
        raise TestResultsContractError(
            "TEST_RESULTS_PROBLEM_MISSING",
            f"problem {sub.problem_id} for submission {sub.id} is missing",
            status_code=409,
        )

    if sub.language not in supported_languages(problem):
        raise TestResultsContractError(
            "TEST_RESULTS_LANGUAGE_UNSUPPORTED",
            f"test_results language {sub.language!r} is not executable for problem {sub.problem_id}",
            status_code=409,
        )

    suite = testcase_loader.get_index().get(problem.source_path)
    if suite is None:
        raise TestResultsContractError(
            "TEST_RESULTS_WITHOUT_SIDECAR",
            f"problem {sub.problem_id} has no loaded test sidecar; omit test_results",
            status_code=409,
        )

    verdict = test_results.get("verdict")
    passed = test_results.get("passed")
    total = test_results.get("total")
    failures = test_results.get("failures") or []
    if verdict not in _RUN_VERDICTS:
        raise TestResultsContractError("TEST_RESULTS_BAD_VERDICT", "invalid test_results.verdict")
    if not isinstance(passed, int) or isinstance(passed, bool):
        raise TestResultsContractError("TEST_RESULTS_BAD_PASSED", "test_results.passed must be an integer")
    if not isinstance(total, int) or isinstance(total, bool):
        raise TestResultsContractError("TEST_RESULTS_BAD_TOTAL", "test_results.total must be an integer")
    if not isinstance(failures, list):
        raise TestResultsContractError("TEST_RESULTS_BAD_FAILURES", "test_results.failures must be a list")

    case_by_id = {case.id: case for case in suite.cases}
    expected_total = len(case_by_id)
    if total != expected_total:
        raise TestResultsContractError(
            "TEST_RESULTS_TOTAL_MISMATCH",
            f"test_results.total={total} does not match problem {sub.problem_id} test suite size {expected_total}",
        )
    if passed < 0 or passed > total:
        raise TestResultsContractError(
            "TEST_RESULTS_PASSED_OUT_OF_RANGE",
            f"test_results.passed={passed} is outside 0..{total}",
        )

    seen_ids: set[str] = set()
    normalized_failures: list[dict] = []
    for failure in failures:
        if not isinstance(failure, dict):
            raise TestResultsContractError("TEST_RESULTS_BAD_FAILURE", "each failure must be an object")
        case_id = failure.get("id")
        if not isinstance(case_id, str) or not case_id:
            raise TestResultsContractError("TEST_RESULTS_BAD_FAILURE_ID", "failure.id must be a non-empty string")
        if case_id in seen_ids:
            raise TestResultsContractError(
                "TEST_RESULTS_DUPLICATE_FAILURE_ID",
                f"duplicate failure id {case_id!r}",
            )
        case = case_by_id.get(case_id)
        if case is None:
            raise TestResultsContractError(
                "TEST_RESULTS_UNKNOWN_FAILURE_ID",
                f"failure id {case_id!r} is not in problem {sub.problem_id} test suite",
            )
        seen_ids.add(case_id)
        normalized_failures.append(failure)

        if failure.get("is_sample") != case.is_sample:
            raise TestResultsContractError(
                "TEST_RESULTS_SAMPLE_FLAG_MISMATCH",
                f"failure {case_id!r} has is_sample={failure.get('is_sample')!r}, expected {case.is_sample}",
            )
        status = failure.get("status")
        if status not in _FAILURE_SEVERITY:
            raise TestResultsContractError(
                "TEST_RESULTS_BAD_FAILURE_STATUS",
                f"failure {case_id!r} has invalid status {status!r}",
            )
        if not case.is_sample and any(
            failure.get(key) is not None
            for key in ("stdin", "expected", "actual", "stderr")
        ):
            raise TestResultsContractError(
                "TEST_RESULTS_HIDDEN_CASE_LEAK",
                f"hidden failure {case_id!r} must not include stdin, expected, actual, or stderr",
            )

    if verdict == "COMPILE_ERROR":
        if passed != 0 or normalized_failures:
            raise TestResultsContractError(
                "TEST_RESULTS_COMPILE_ERROR_SHAPE",
                "COMPILE_ERROR requires passed=0 and no per-case failures",
            )
        if not str(test_results.get("error") or "").strip():
            raise TestResultsContractError(
                "TEST_RESULTS_COMPILE_ERROR_MISSING_ERROR",
                "COMPILE_ERROR requires a syntax error message",
            )
        return

    if str(test_results.get("error") or "").strip():
        raise TestResultsContractError(
            "TEST_RESULTS_UNEXPECTED_ERROR",
            "test_results.error is only valid for COMPILE_ERROR",
        )

    if passed + len(normalized_failures) != total:
        raise TestResultsContractError(
            "TEST_RESULTS_COUNT_MISMATCH",
            f"passed ({passed}) + failures ({len(normalized_failures)}) must equal total ({total})",
        )

    if verdict == "OK":
        if passed != total or normalized_failures:
            raise TestResultsContractError(
                "TEST_RESULTS_OK_SHAPE",
                "OK requires passed=total and an empty failures list",
            )
        return

    if passed >= total or not normalized_failures:
        raise TestResultsContractError(
            "TEST_RESULTS_FAILURE_SHAPE",
            f"{verdict} requires at least one failed case and passed < total",
        )
    top_failure = _top_failure_verdict(normalized_failures)
    if top_failure != verdict:
        raise TestResultsContractError(
            "TEST_RESULTS_VERDICT_MISMATCH",
            f"test_results.verdict={verdict} does not match top failure status {top_failure}",
        )


def _authoritative_test_results(
    db: Session,
    sub: Submission,
    *,
    code: str,
    client_results: dict | None,
) -> dict | None:
    """Return backend-computed execution evidence when the executor is enabled.

    Client Pyodide output is still accepted as a UX hint, but never persisted as
    ground truth without the backend recomputing the same suite. This keeps final
    ratings and SRS schedules grounded in evidence the API produced itself.
    """

    from app.settings import settings

    if settings.EXECUTOR == "none":
        return None

    problem = db.get(Problem, sub.problem_id)
    if problem is None:
        raise TestResultsContractError(
            "TEST_RESULTS_PROBLEM_MISSING",
            f"problem {sub.problem_id} for submission {sub.id} is missing",
            status_code=409,
        )

    if sub.language not in supported_languages(problem):
        raise TestResultsContractError(
            "TEST_RESULTS_LANGUAGE_UNSUPPORTED",
            f"language {sub.language!r} is not executable for problem {sub.problem_id}",
            status_code=409,
        )

    suite = testcase_loader.get_index().get(problem.source_path)
    if suite is None:
        if client_results is None:
            return None
        raise TestResultsContractError(
            "TEST_RESULTS_WITHOUT_SIDECAR",
            f"problem {sub.problem_id} has no loaded test sidecar; omit test_results",
            status_code=409,
        )

    if client_results is not None:
        _validate_test_results_contract(db, sub, client_results)

    server_results = run_python_suite(code, suite)
    _validate_test_results_contract(db, sub, server_results)
    if client_results is not None and not _same_execution_summary(client_results, server_results):
        log.warning(
            "client execution evidence differed from backend result for submission %s "
            "(client=%s/%s/%s backend=%s/%s/%s); using backend result",
            sub.id,
            client_results.get("verdict"),
            client_results.get("passed"),
            client_results.get("total"),
            server_results.get("verdict"),
            server_results.get("passed"),
            server_results.get("total"),
        )
    return server_results


def _same_execution_summary(left: dict, right: dict) -> bool:
    def compact(result: dict) -> tuple:
        failures = result.get("failures") or []
        return (
            result.get("verdict"),
            result.get("passed"),
            result.get("total"),
            tuple(
                (f.get("id"), f.get("is_sample"), f.get("status"))
                for f in failures
                if isinstance(f, dict)
            ),
            bool(str(result.get("error") or "").strip()),
        )

    return compact(left) == compact(right)


def review_queue_state(
    db: Session,
    *,
    stale_after: timedelta = REVIEW_STALE_AFTER,
    now: datetime | None = None,
) -> dict:
    ts = now or _now()
    reviewing = db.execute(
        select(Submission).where(
            Submission.status == "reviewing",
            Submission.reviewed_at.is_(None),
        )
    ).scalars().all()
    stale = [
        sub for sub in reviewing if _is_stale_review(sub, now=ts, stale_after=stale_after)
    ]
    oldest = min((_review_clock(sub) for sub in reviewing if _review_clock(sub)), default=None)
    return {
        "pending_review_count": len(reviewing),
        "stale_review_count": len(stale),
        "review_stale_after_sec": int(stale_after.total_seconds()),
        "oldest_review_started_at": oldest.isoformat() if oldest else None,
    }


def recover_stale_reviews(
    db: Session,
    *,
    stale_after: timedelta = REVIEW_STALE_AFTER,
    now: datetime | None = None,
) -> int:
    ts = now or _now()
    reviewing = db.execute(
        select(Submission).where(
            Submission.status == "reviewing",
            Submission.reviewed_at.is_(None),
        )
    ).scalars().all()
    recovered = 0
    for sub in reviewing:
        if not _is_stale_review(sub, now=ts, stale_after=stale_after):
            continue
        sub.status = "review_failed"
        sub.reviewed_at = ts
        sub.review_last_error_code = REVIEW_INTERRUPTED_CODE
        sub.review_json = _interrupted_review_payload(sub)
        sub.review_rating = None
        sub.review_can_compile = None
        recovered += 1
    if recovered:
        db.commit()
    return recovered


def create_draft(
    db: Session,
    *,
    problem_id: int,
    mode: Literal["untimed", "timed"],
    mode_limit_sec: int | None,
    language: str = "python",
) -> Submission:
    """新建一条 draft 提交。

    raises:
      LookupError — problem_id 不存在（路由层 → 404 PROBLEM_NOT_FOUND）。
      ValueError  — language 不在该题 supported_languages 内（题目存在，
                    仅语言不支持，路由层 → 409 LANGUAGE_NOT_SUPPORTED，绝不误报 404）。
    """
    problem = db.get(Problem, problem_id)
    if problem is None:
        raise LookupError(f"problem id {problem_id} not found")
    # 语言守门：JavaScript 已下线，supported_languages 恒为 ["python"]，任何非 Python
    # 语言在此被拒（防前端绕过）。
    supported = supported_languages(problem)
    if language not in supported:
        raise ValueError(
            f"language {language!r} not available for problem {problem_id} "
            f"(supported: {supported})"
        )
    sub = Submission(
        id=str(uuid.uuid4()),
        problem_id=problem_id,
        code="",
        elapsed_sec=0,
        mode=mode,
        mode_limit_sec=mode_limit_sec,
        language=language,
        status="draft",
        created_at=datetime.now(timezone.utc),
    )
    db.add(sub)
    db.commit()
    db.refresh(sub)
    return sub


def add_snapshots(
    db: Session,
    submission_id: str,
    snapshots: list[dict],
) -> tuple[int, int]:
    """批量上报快照。返回 (accepted, duplicates)。

    使用 SQLite 的 INSERT ... ON CONFLICT DO NOTHING；冲突的 (submission_id, t_offset_sec)
    会被静默丢弃，duplicates 通过 before/after rowcount 差额估算。
    """
    if not snapshots:
        return 0, 0

    rows = [
        {
            "submission_id": submission_id,
            "t_offset_sec": s["t_offset_sec"],
            "code": s["code"],
            "code_hash": s["code_hash"],
            "client_ts": s["client_ts"],
            "created_at": datetime.now(timezone.utc),
        }
        for s in snapshots
    ]

    stmt = sqlite_insert(Snapshot).values(rows)
    stmt = stmt.on_conflict_do_nothing(
        index_elements=["submission_id", "t_offset_sec"]
    )
    result = db.execute(stmt)
    db.commit()
    accepted = int(result.rowcount or 0)
    duplicates = len(rows) - accepted
    return accepted, duplicates


def finalize(
    db: Session,
    submission_id: str,
    *,
    code: str,
    elapsed_sec: int,
    test_results: dict | None = None,
) -> Submission:
    """冻结提交并立即返回（异步评测，）。

    只做 freeze：置 ``status=reviewing``、写 code / elapsed_sec / submitted_at /
    test_results_json，commit 让后台独立 session 能读到。LLM 评测 + SRS 排程由调用方用
    ``BackgroundTasks`` 调 :func:`run_review_pipeline` 在后台跑；``reviewed_at`` 保持 None
    作 pending 哨兵。

    ``test_results``：若客户端带了浏览器预跑结果，先校验协议形状；最终落库的是
    后端按同一测试套件复跑得到的 RunResult。后台评测据它短路 / 喂 LLM；retry 重评也重读它。
    无测试套件或 EXECUTOR=none → None（纯 LLM 降级）。
    """
    sub = db.get(Submission, submission_id)
    if sub is None:
        raise LookupError("submission not found")
    if sub.status != "draft":
        raise ValueError("already submitted")
    test_results = _authoritative_test_results(
        db,
        sub,
        code=code,
        client_results=test_results,
    )

    now = _now()
    sub.code = code
    sub.elapsed_sec = elapsed_sec
    sub.test_results_json = test_results
    sub.submitted_at = now
    _begin_review_attempt(sub, now=now)
    # 后台评测在独立 session 里读 submission，必须先 commit 让 code / test_results 可见
    db.commit()
    review_progress.publish(submission_id, "queued", reset=True)
    db.refresh(sub)
    return sub


def run_review_pipeline(submission_id: str) -> None:
    """``BackgroundTasks`` 入口：自开独立 session 跑「评测 + 落库 + SRS + 状态翻转」。

    finalize / retry_review 都把它丢进 ``background.add_task``。读 submission 用独立
    session（调用方已先 commit，code 可见）。
    """
    with SessionLocal() as db:
        apply_review(db, submission_id)


def retry_review(db: Session, submission_id: str) -> Submission:
    """重试评测：同一 submission 重新进入 reviewing，并记录一次新的尝试。"""
    sub = db.get(Submission, submission_id)
    if sub is None:
        raise LookupError("submission not found")
    if sub.status not in ("submitted", "review_failed"):
        raise ValueError("not_retryable")
    _begin_review_attempt(sub)
    db.commit()
    review_progress.publish(submission_id, "queued", reset=True)
    db.refresh(sub)
    return sub


def apply_review(db: Session, submission_id: str) -> None:
    """评测落库 + 状态翻转（由调用方注入 session）。

    run-then-review按 ``EXECUTOR`` + 执行 verdict 分三路产出 review：
      - 编译/运行错（COMPILE_ERROR / RUNTIME_ERROR）→ ``deterministic_review`` 确定性判定，
        **不调 LLM** 省 token；
      - 能跑的代码（OK / WRONG / TLE）→ ``review_with_session(test_results=...)`` 把执行结果
        作正确性 ground truth 喂 LLM；
      - 无执行 / EXECUTOR=none → 纯 LLM（现状不变，降级）。
    ``review_can_compile`` 接缝：有执行时由 verdict 填
    （``COMPILE_ERROR`` → False，其余 → True，因 RUNTIME_ERROR 表示代码已编译）；无执行时回退
    LLM 的 ``can_compile``。``review_json`` 内的 ``can_compile`` 仍是 LLM 静态判断，二字段并存。

    落库语义同前：
    - 成功（含确定性短路，无 ``.error``）：写 review_json / rating / can_compile / reviewed_at、
      ``status=submitted``，再跑 SRS（短路的 C/D 同样进 SRS，重置间隔 + 解锁续编）。
    - 降级（LLM 重试耗尽，review 带 ``.error``）：``status=review_failed``、``review_rating=None``
      （srs_service 见 None 自动跳过排程），``reviewed_at`` 仍落值让前端停轮询。
    """
    from app.settings import settings
    from app.services import llm_review, srs_service

    sub = db.get(Submission, submission_id)
    if sub is None:
        return  # 提交已被删除：放弃这次后台评测

    # EXECUTOR=none → 忽略任何 test_results，强制纯 LLM 降级。
    tr = sub.test_results_json if settings.EXECUTOR != "none" else None

    def progress(stage: str, detail: dict | None = None) -> None:
        review_progress.publish(submission_id, stage, detail)

    if tr and tr.get("verdict") in ("COMPILE_ERROR", "RUNTIME_ERROR"):
        progress("deterministic_shortcut", {"verdict": tr.get("verdict")})
        review = llm_review.deterministic_review(tr)  # 短路：不调 LLM
        review_mode = "deterministic"
    elif tr:
        review = llm_review.review_with_session(
            db, submission_id, test_results=tr, on_progress=progress
        )
        review_mode = "llm"
    else:
        review = llm_review.review_with_session(
            db, submission_id, on_progress=progress
        )  # 纯 LLM
        review_mode = "llm"

    llm_review.ensure_review_meta(
        review,
        tr,
        review_mode=review_mode,
        model=(
            "deterministic"
            if review_mode == "deterministic"
            else settings.LLM_MODEL
        ),
    )

    failed = bool(review.get("error"))
    if failed:
        review["rating"] = None

    sub.review_json = review
    # review_can_compile：有执行时由 verdict 权威填充，否则回退 LLM 判断。
    if tr:
        sub.review_can_compile = tr.get("verdict") != "COMPILE_ERROR"
    else:
        sub.review_can_compile = review.get("can_compile")
    sub.reviewed_at = _now()
    if failed:
        sub.review_last_error_code = review.get("error_code") or "REVIEW_FAILED"
        sub.review_rating = None
        sub.status = "review_failed"
        db.commit()
        progress(
            "done",
            {"status": sub.status, "error_code": sub.review_last_error_code},
        )
        return

    sub.review_last_error_code = None
    sub.review_rating = review.get("rating")
    sub.status = "submitted"
    if sub.review_rating is not None:
        # Keep the submitted terminal state and its SRS schedule in the same
        # commit. Otherwise the live app can briefly render a finished review
        # as "排程未改变" before the schedule commit lands.
        srs_service.upsert_mastery_and_schedule(db, sub)
    else:
        db.commit()
    progress(
        "done",
        {"status": sub.status, "error_code": sub.review_last_error_code},
    )


def continue_from(db: Session, old_id: str) -> tuple[Submission, int]:
    """C/D 评级 + untimed 的提交允许「续编」:开一个新 submission 接着写。

    - 新 sub.parent_submission_id 指向 old.id
    - 旧 sub 的所有快照原样复制到新 sub(同 t_offset_sec / code / code_hash / client_ts)
    - 末尾追加一帧 kind="submit_marker" 帧,标注「这一刻学生曾经提交一次」
    - elapsed_sec 从 old 继承,新会话的计时与快照都从 marker 之后接着累加

    返回 (new_sub, t_offset_resume):前端用 t_offset_resume 作为下一帧快照对齐基线。

    raises:
      LookupError("submission not found") — old_id 不存在
      ValueError 三种语义:
        - "not_submitted"        — 旧 sub 还在 draft / 状态异常
        - "not_untimed"          — timed 模式不允许续编
        - "rating_not_eligible"  — 当前 effective 评级是 A/B(已掌握)或为空,不进入续编流
    """
    old = db.get(Submission, old_id)
    if old is None:
        raise LookupError("submission not found")
    if old.status != "submitted":
        raise ValueError("not_submitted")
    if old.mode != "untimed":
        raise ValueError("not_untimed")
    if _continuation_effective_rating(db, old) not in ("C", "D"):
        raise ValueError("rating_not_eligible")

    now = datetime.now(timezone.utc)

    # marker 时间戳:取 max(旧快照最大 t, elapsed_sec)向上对齐到下一个 30 倍数,
    # 保证它严格大于复制过来的所有 t_offset,避免 (submission_id, t_offset_sec) 唯一约束冲突。
    max_t = db.execute(
        select(func.coalesce(func.max(Snapshot.t_offset_sec), 0))
        .where(Snapshot.submission_id == old_id)
    ).scalar_one()
    base_t = max(int(max_t or 0), int(old.elapsed_sec or 0))
    marker_t = (base_t // 30 + 1) * 30

    new_id = str(uuid.uuid4())
    new_sub = Submission(
        id=new_id,
        problem_id=old.problem_id,
        code=old.code or "",
        elapsed_sec=old.elapsed_sec or 0,
        mode="untimed",
        mode_limit_sec=None,
        language=old.language,  # 续编沿用上一轮语言
        status="draft",
        parent_submission_id=old.id,
        created_at=now,
    )
    db.add(new_sub)
    db.flush()  # 让 new_id 在外键约束下可用

    # 只复制 kind="code" 的快照;旧的 marker 帧不递归,避免 chain 多级时 rating 反查歧义。
    # 当前 sub 的 review prompt 通过 parent.review_rating 决定 marker 的 rating。
    old_snaps = (
        db.execute(
            select(Snapshot)
            .where(Snapshot.submission_id == old_id, Snapshot.kind == "code")
            .order_by(Snapshot.t_offset_sec.asc())
        )
        .scalars()
        .all()
    )
    for s in old_snaps:
        db.add(
            Snapshot(
                submission_id=new_id,
                t_offset_sec=s.t_offset_sec,
                code=s.code,
                code_hash=s.code_hash,
                kind="code",
                client_ts=s.client_ts,
                created_at=now,
            )
        )

    marker_hash = hashlib.sha1((old.code or "").encode("utf-8")).hexdigest()[:12]
    db.add(
        Snapshot(
            submission_id=new_id,
            t_offset_sec=marker_t,
            code=old.code or "",
            code_hash=marker_hash,
            kind="submit_marker",
            client_ts=now,
            created_at=now,
        )
    )

    db.commit()
    db.refresh(new_sub)
    return new_sub, marker_t


def _continuation_effective_rating(db: Session, old: Submission) -> str | None:
    mastery = db.scalar(select(Mastery).where(Mastery.problem_id == old.problem_id))
    if mastery is None:
        return old.user_rating_override or old.review_rating
    if mastery.last_submission_id and mastery.last_submission_id != old.id:
        return None
    return (
        mastery.user_rating
        or mastery.auto_rating
        or old.user_rating_override
        or old.review_rating
    )


def list_for_problem(
    db: Session,
    problem_id: int,
    *,
    status: Literal["submitted", "all"] = "submitted",
    limit: int = 20,
    offset: int = 0,
) -> tuple[list[dict], int]:
    """题目的历次提交概览。按 submitted_at desc（draft 在尾巴用 created_at）。"""
    base = select(Submission).where(Submission.problem_id == problem_id)
    if status == "submitted":
        base = base.where(Submission.status == "submitted")

    total = db.execute(
        select(func.count()).select_from(base.subquery())
    ).scalar_one()

    # snapshots_count 子查询
    snap_count_subq = (
        select(
            Snapshot.submission_id,
            func.count().label("cnt"),
        )
        .group_by(Snapshot.submission_id)
        .subquery()
    )

    stmt = (
        select(Submission, func.coalesce(snap_count_subq.c.cnt, 0).label("snap_count"))
        .where(Submission.problem_id == problem_id)
        .outerjoin(snap_count_subq, snap_count_subq.c.submission_id == Submission.id)
        .order_by(Submission.submitted_at.desc().nulls_last(), Submission.created_at.desc())
        .limit(limit)
        .offset(offset)
    )
    if status == "submitted":
        stmt = stmt.where(Submission.status == "submitted")

    rows = db.execute(stmt).all()
    items = [
        {
            "id": sub.id,
            "status": sub.status,
            "submitted_at": sub.submitted_at,
            "elapsed_sec": sub.elapsed_sec,
            "mode": sub.mode,
            "language": sub.language,
            "review_rating": sub.review_rating,
            "user_rating_override": sub.user_rating_override,
            "snapshots_count": int(cnt),
        }
        for (sub, cnt) in rows
    ]
    return items, int(total)


def list_snapshots(db: Session, submission_id: str) -> list[dict]:
    """按 t_offset_sec 升序返回该提交的所有快照。

    附带 kind；marker 帧带"上次提交评级"(= 父提交 review_rating)，供前端回放标注。
    """
    # marker 帧的 rating = 直接前驱(parent)的评级；chain 多级时父的 marker 不被复制，
    # 故当前 sub 的所有 marker 共享同一 rating。镜像 llm_review.review_with_session 的反查口径。
    parent_rating: str | None = None
    sub = db.get(Submission, submission_id)
    if sub is not None and sub.parent_submission_id:
        parent = db.get(Submission, sub.parent_submission_id)
        if parent is not None:
            parent_rating = parent.review_rating
    rows = (
        db.execute(
            select(Snapshot)
            .where(Snapshot.submission_id == submission_id)
            .order_by(Snapshot.t_offset_sec.asc())
        )
        .scalars()
        .all()
    )
    return [
        {
            "t_offset_sec": s.t_offset_sec,
            "code": s.code,
            "code_hash": s.code_hash,
            "kind": s.kind,
            "rating": parent_rating if s.kind == "submit_marker" else None,
        }
        for s in rows
    ]


def delete_one(db: Session, submission_id: str) -> bool:
    """删除一条 submission；返回是否真的存在并被删除。

    级联（由模型层 FK 决定，SQLite PRAGMA foreign_keys=ON 已在 session 启动时开启）：
      - snapshot.submission_id           → CASCADE 删除该 sub 的全部代码快照
      - review_schedule.from_submission_id → CASCADE 删除以该 sub 为源的 SRS 排程
      - mastery / review_schedule        → 删除后按该题剩余最新 submitted 记录重建；
                                            若没有剩余自动评级证据，则清空 auto_rating。
      - submission.parent_submission_id  → SET NULL（续编链中以该 sub 为父的子提交
                                            会断开链接，但本身不被删除）
    """
    sub = db.get(Submission, submission_id)
    if sub is None:
        return False
    problem_id = sub.problem_id
    db.delete(sub)
    db.flush()
    _rebuild_problem_progress_after_delete(db, {problem_id})
    db.commit()
    return True


def delete_many(db: Session, ids: list[str]) -> tuple[int, list[str]]:
    """批量删除；返回 (deleted_count, not_found_ids)。

    级联策略与 delete_one 一致。逐条 db.delete 保持与单条删除完全相同的 ORM 行为。
    批量大小由 API 层限制。
    """
    if not ids:
        return 0, []
    existing = (
        db.execute(select(Submission).where(Submission.id.in_(ids)))
        .scalars()
        .all()
    )
    found_ids = {s.id for s in existing}
    not_found = [i for i in ids if i not in found_ids]
    problem_ids = {sub.problem_id for sub in existing}
    for sub in existing:
        db.delete(sub)
    db.flush()
    _rebuild_problem_progress_after_delete(db, problem_ids)
    db.commit()
    return len(existing), not_found


def _rebuild_problem_progress_after_delete(db: Session, problem_ids: set[int]) -> None:
    """Recompute per-problem mastery/SRS after removing submission evidence."""

    if not problem_ids:
        return
    from app.services import srs_service

    for problem_id in problem_ids:
        latest = (
            db.execute(
                select(Submission)
                .where(
                    Submission.problem_id == problem_id,
                    Submission.status == "submitted",
                    Submission.review_rating.is_not(None),
                )
                .order_by(
                    Submission.submitted_at.desc(),
                    Submission.created_at.desc(),
                    Submission.id.desc(),
                )
                .limit(1)
            )
            .scalars()
            .first()
        )
        mastery = db.scalar(select(Mastery).where(Mastery.problem_id == problem_id))

        if latest is None:
            schedule = db.scalar(
                select(ReviewSchedule).where(ReviewSchedule.problem_id == problem_id)
            )
            if schedule is not None:
                db.delete(schedule)
            if mastery is None:
                continue
            mastery.auto_rating = None
            mastery.user_rating = None
            mastery.last_submission_id = None
            db.delete(mastery)
            continue

        if mastery is None:
            mastery = Mastery(problem_id=problem_id)
            db.add(mastery)
        mastery.auto_rating = latest.review_rating
        mastery.user_rating = latest.user_rating_override
        mastery.last_submission_id = latest.id
        db.flush()
        srs_service._refresh_schedule(
            db,
            problem_id,
            from_submission_id=latest.id,
            anchor_ts=latest.submitted_at,
        )


def get_detail(db: Session, submission_id: str) -> dict | None:
    sub = db.get(Submission, submission_id)
    if sub is None:
        return None
    snap_count = db.execute(
        select(func.count()).select_from(Snapshot).where(Snapshot.submission_id == submission_id)
    ).scalar_one()
    schedule = db.scalar(
        select(ReviewSchedule).where(ReviewSchedule.from_submission_id == submission_id)
    )
    schedule_view = (
        {
            "next_review_at": schedule.next_review_at,
            "interval_days": schedule.interval_days,
            "generated_from_rating": schedule.generated_from_rating,
            "prior_interval_days": schedule.prior_interval_days,
        }
        if schedule is not None
        else None
    )
    review_view = (
        dict(sub.review_json) if isinstance(sub.review_json, dict) else sub.review_json
    )
    if isinstance(review_view, dict):
        review_view.pop("review_meta", None)
    return {
        "id": sub.id,
        "problem_id": sub.problem_id,
        "status": sub.status,
        "code": sub.code,
        "elapsed_sec": sub.elapsed_sec,
        "mode": sub.mode,
        "mode_limit_sec": sub.mode_limit_sec,
        "language": sub.language,
        "created_at": sub.created_at,
        "submitted_at": sub.submitted_at,
        "reviewed_at": sub.reviewed_at,
        "review_started_at": sub.review_started_at,
        "review_attempts": int(sub.review_attempts or 0),
        "review_last_error_code": sub.review_last_error_code,
        "review": review_view,
        "review_schedule": schedule_view,
        "user_rating_override": sub.user_rating_override,
        "snapshots_count": int(snap_count),
    }
