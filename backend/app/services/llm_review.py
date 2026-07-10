"""LLM 评测与求助服务。

替换的 stub。
"""

from __future__ import annotations

import json
import logging
from collections import Counter
from collections.abc import Callable
from pathlib import Path
from typing import Any

from jinja2 import Environment, FileSystemLoader, select_autoescape
from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.session import SessionLocal
from app.models import Problem, Snapshot, Submission
from app.schemas.review import ReviewOutput, strict_json_schema
from app.services.diff_util import unified_diff
from app.services.llm_client import (
    LLMClient,
    LLMNotConfigured,
    LLMOutputInvalid,
    LLMUnavailable,
    get_client,
)
from app.settings import settings

log = logging.getLogger(__name__)

_PROMPT_DIR = Path(__file__).resolve().parent / "prompts"
_env = Environment(
    loader=FileSystemLoader(str(_PROMPT_DIR)),
    autoescape=select_autoescape(default_for_string=False),
    keep_trailing_newline=True,
)


def _render(template_name: str, **ctx: Any) -> str:
    return _env.get_template(template_name).render(**ctx)


def _system_prompt(name: str) -> str:
    return (_PROMPT_DIR / name).read_text(encoding="utf-8")


def _reference_for(problem: Problem, language: str) -> str:
    """取参考解。

    JavaScript 已下线，现仅 Python；``reference_solution_md`` 即其参考解。language
    形参来自提交对象，当前只用于保持调用签名清晰。
    """
    return problem.reference_solution_md


# === 时间线抽样 ===

def _subsample_timeline(snapshots: list[dict], target_max: int = 25) -> list[dict]:
    """把可能 100+ 帧的时间线抽样到 target_max 帧以内。

    策略：
      - `kind != "code"` 的节点(如 submit_marker)强制保留,不进入抽样池
      - 其余 code 帧按"首 2 + 尾 2 + 中间等距"策略压缩到 (target_max - markers) 内
      - 输出按 t_offset_sec 升序

    若 snapshot 记录没有 kind 列，调用方传 `kind="code"` 即可按代码帧处理。
    """
    markers = [s for s in snapshots if s.get("kind", "code") != "code"]
    codes = [s for s in snapshots if s.get("kind", "code") == "code"]

    quota = max(target_max - len(markers), 4)
    if len(codes) <= quota:
        sampled_codes = codes
    elif quota <= 4:
        # 名额吃紧:只保首 2 + 尾 2,中间整个丢弃
        sampled_codes = codes[:2] + codes[-2:]
    else:
        head, tail = codes[:2], codes[-2:]
        middle = codes[2:-2]
        middle_quota = quota - 4
        if len(middle) <= middle_quota:
            sampled_codes = head + middle + tail
        else:
            step = len(middle) / middle_quota
            picks = [middle[int(i * step)] for i in range(middle_quota)]
            sampled_codes = head + picks + tail

    return sorted(sampled_codes + markers, key=lambda s: s["t_offset_sec"])


def _render_timeline(sampled: list[dict]) -> list[dict]:
    """把抽样后的快照转成模板可消费的渲染节点。

    元素结构:
      - {kind: "full",   t, code}        — 第一段 code 节点(完整代码)
      - {kind: "diff",   t, diff_text}   — 后续 code 节点(相对上一段 code 的 unified diff)
      - {kind: "marker", t, rating}      — 历史提交点(让 LLM 知道这一刻学生曾经提交过)
    """
    out: list[dict] = []
    prev_code: str | None = None
    for node in sampled:
        kind = node.get("kind", "code")
        t = node["t_offset_sec"]
        if kind == "submit_marker":
            out.append(
                {"kind": "marker", "t": t, "rating": node.get("rating") or "?"}
            )
            # marker 不影响 prev_code:marker.code 等于上一次提交时的最终代码,
            # 与最近一帧 code 几乎相同,不在它后面叠 diff 更干净。
            continue
        code = node.get("code") or ""
        if prev_code is None:
            out.append({"kind": "full", "t": t, "code": code})
        else:
            out.append(
                {"kind": "diff", "t": t, "diff_text": unified_diff(prev_code, code)}
            )
        prev_code = code
    return out


# === B/C 自一致采样参数 ===

# 补采样略升温求多样性（主调用仍 0.2）。
_RESAMPLE_TEMPERATURE = 0.5
# 保守序：评级互不相同（无多数）时取"最低"。D < C < B < A。
_CONSERVATIVE_ORDER = {"D": 0, "C": 1, "B": 2, "A": 3}
# Review meta is persisted for backend debugging only; public APIs strip it out.
_REVIEW_META_SCHEMA_VERSION = 2
_PROMPT_VERSION = (_PROMPT_DIR / "VERSION").read_text(encoding="utf-8").strip()
_MAX_INVALID_RETRIES = 1
_FAILURE_VERDICTS = {"WRONG", "TLE"}
_HIGH_RATINGS = {"A", "B"}


def _conservative_majority(ratings: list[str]) -> str:
    """多数票；并列（含三者互异）取最保守（最低）评级。

    例：B,C,C→C ; B,B,C→B ; B,C,A→C ; 退化样本 [B,C]→C ; [B]→B。
    """
    counts = Counter(ratings)
    top = max(counts.values())
    tied = [r for r, c in counts.items() if c == top]
    return min(tied, key=lambda r: _CONSERVATIVE_ORDER.get(r, 0))


def _client_model(client: LLMClient) -> str:
    return str(getattr(client, "model", settings.LLM_MODEL))


def _review_meta(
    test_results: dict | None,
    *,
    review_mode: str,
    model: str | None,
    structured_output_mode: str | None = None,
    self_consistency_sample_count: int = 1,
    sample_ratings: list[str] | None = None,
    guardrail_applied: bool = False,
    invalid_retry_count: int = 0,
    consistency_warning: str | None = None,
) -> dict:
    tr = test_results or {}
    return {
        "schema_version": _REVIEW_META_SCHEMA_VERSION,
        "prompt_version": _PROMPT_VERSION,
        "model": model,
        "review_mode": review_mode,
        "grounded_by_tests": bool(test_results),
        "execution_verdict": tr.get("verdict"),
        "passed_cases": tr.get("passed"),
        "total_cases": tr.get("total"),
        "self_consistency_sample_count": self_consistency_sample_count,
        "sample_ratings": sample_ratings or [],
        "guardrail_applied": guardrail_applied,
        "invalid_retry_count": invalid_retry_count,
        "consistency_warning": consistency_warning,
        "structured_output_mode": structured_output_mode,
    }


def ensure_review_meta(
    review: dict,
    test_results: dict | None,
    *,
    review_mode: str,
    model: str | None = None,
) -> dict:
    """给非 LLM 主路径补最小 review_meta；已有 meta 不覆盖。"""
    if "review_meta" in review:
        return review
    rating = review.get("rating")
    review["review_meta"] = _review_meta(
        test_results,
        review_mode=review_mode,
        model=model,
        self_consistency_sample_count=1 if rating else 0,
        sample_ratings=[rating] if rating else [],
        guardrail_applied=False,
        invalid_retry_count=0,
    )
    return review


def _is_illegal_high_rating(review: ReviewOutput, test_results: dict | None) -> bool:
    verdict = (test_results or {}).get("verdict")
    return verdict in _FAILURE_VERDICTS and review.rating in _HIGH_RATINGS


def _consistency_warning(review: ReviewOutput, test_results: dict | None) -> str | None:
    if (test_results or {}).get("verdict") == "OK" and review.can_compile is False:
        return "execution_verdict_ok_but_llm_can_compile_false"
    return None


def _downgrade_to_c(review: ReviewOutput) -> dict:
    data = review.model_dump()
    data["rating"] = "C"
    data["rating_rationale"] = (
        "执行结果为 WRONG/TLE，服务层按最高 C 的不变量保守降级。"
        f"模型原始理由：{review.rating_rationale}"
    )
    return data


# === run-then-review ===

# 失败用例喂 LLM 的截断（控 token）：样例优先、取前 N 个、各字段截长。
_MAX_FAILURES_TO_LLM = 3
_FAILURE_FIELD_MAXLEN = 500


def _truncate(s: str | None, n: int = _FAILURE_FIELD_MAXLEN) -> str | None:
    if s is None:
        return None
    return s if len(s) <= n else s[:n] + "…(截断)"


def _render_test_results(test_results: dict | None) -> dict | None:
    """把执行结果整理成 review_user.j2 友好的结构（仅"喂 LLM"路径用，即 OK/WRONG/TLE）。

    - 样例失败优先（带完整 I/O，诊断价值高）；非样例失败（I/O 已被前端置 null 防泄）补其后。
    - 取前 ``_MAX_FAILURES_TO_LLM`` 个，各字段截断到 ``_FAILURE_FIELD_MAXLEN``。
    - ``None`` / 空 → ``None``（模板条件块不渲染，纯 LLM 降级）。
    """
    if not test_results:
        return None
    failures = test_results.get("failures") or []
    # 样例优先（is_sample=True 排前）；sorted 稳定，组内保留原顺序。
    ordered = sorted(failures, key=lambda f: not f.get("is_sample"))
    picked = [
        {
            "id": f.get("id"),
            "is_sample": f.get("is_sample"),
            "status": f.get("status"),
            "stdin": _truncate(f.get("stdin")),
            "expected": _truncate(f.get("expected")),
            "actual": _truncate(f.get("actual")),
            "stderr": _truncate(f.get("stderr")),
        }
        for f in ordered[:_MAX_FAILURES_TO_LLM]
    ]
    return {
        "verdict": test_results.get("verdict"),
        "passed": test_results.get("passed"),
        "total": test_results.get("total"),
        "failures": picked,
        "n_failures_total": len(failures),
    }


def deterministic_review(test_results: dict) -> dict:
    """编译/运行错的确定性评测（不调 LLM 省 token）。

    - ``COMPILE_ERROR`` → rating **D**，``can_compile=False``，compile_issues 带语法错信息。
    - ``RUNTIME_ERROR`` → rating **C**，``can_compile=True``（代码已编译、跑起来后才抛错）。

    返回 ReviewOutput 同构 dict（**无 ``error`` 键** → apply_review 走成功分支 → status=submitted
    → 进 SRS，C/D 重置间隔并解锁续编）。
    """
    verdict = test_results.get("verdict")
    passed = test_results.get("passed") or 0
    total = test_results.get("total") or 0
    failures = test_results.get("failures") or []

    if verdict == "COMPILE_ERROR":
        err = _truncate(test_results.get("error")) or "代码存在语法错误。"
        return {
            "scratchpad": "",
            "can_compile": False,
            "compile_issues": [err],
            "quality": {"score": 0, "comments": "代码无法通过 Python 语法检查，请先修正语法错误。"},
            "complexity": {"time": "?", "space": "?", "explain": "代码无法运行，未评估复杂度。"},
            "optimization": [],
            "process_review": "提交的代码存在语法错误，无法运行。请修正语法后再提交评测。",
            "rating": "D",
            "rating_rationale": "代码存在语法错误，无法运行（根据运行结果直接判定，未请求 AI 评测）。",
        }

    # RUNTIME_ERROR：若有样例失败带 traceback，附截断片段补充信息（样例 I/O 公开，可安全展示）。
    sample_err = next(
        (f.get("stderr") for f in failures if f.get("is_sample") and f.get("stderr")),
        None,
    )
    process = (
        "代码能编译，但运行时报错。请根据报错定位崩溃的用例（如越界 / 空值 / 类型错误）后修正。"
    )
    if sample_err:
        process += f"\n样例报错片段：\n{_truncate(sample_err)}"
    return {
        "scratchpad": "",
        "can_compile": True,
        "compile_issues": [],
        "quality": {"score": 2, "comments": "代码运行时报错，先保证在所有用例上不崩溃。"},
        "complexity": {"time": "?", "space": "?", "explain": "代码运行时报错，未评估复杂度。"},
        "optimization": [],
        "process_review": process,
        "rating": "C",
        "rating_rationale": (
            f"代码可编译，但在 {max(total - passed, 0)}/{total} 个用例上运行时抛出异常"
            "（根据运行结果直接判定，未请求 AI 评测）。"
        ),
    }


# === 评测主流程 ===

def review_submission(submission_id: str) -> dict:
    """评测一次提交（自带 session 的薄包装）。

    返回 dict；遇到 LLM 不可用 → 返回降级结果（含 .error），
    不抛异常。不写库，写 review_json 由调用方（submission_service.apply_review）负责。
    """
    with SessionLocal() as db:
        return review_with_session(db, submission_id)


def review_with_session(
    db: Session,
    submission_id: str,
    test_results: dict | None = None,
    *,
    on_progress: Callable[[str, dict | None], None] | None = None,
) -> dict:
    """评测一次提交（注入 session 版）。

    调用方传入现有 session，避免再创建独立连接。语义同 ``review_submission``：
    纯计算，不写库。

    ``test_results``：能跑的代码（OK/WRONG/TLE）的执行结果，注入 prompt 作正确性
    ground truth；None → 纯 LLM 静态评测（现状）。短路（COMPILE/RUNTIME_ERROR）由调用方走
    :func:`deterministic_review`，不进本函数。
    """
    sub = db.get(Submission, submission_id)
    if sub is None:
        return _fallback_review("submission not found", code="REVIEW_CONTEXT_MISSING")
    problem = db.get(Problem, sub.problem_id)
    if problem is None:
        return _fallback_review("problem not found", code="REVIEW_CONTEXT_MISSING")
    snapshots = (
        db.execute(
            select(Snapshot)
            .where(Snapshot.submission_id == submission_id)
            .order_by(Snapshot.t_offset_sec.asc())
        )
        .scalars()
        .all()
    )
    # 拉完整 code(而非只 hash),让 LLM 能看到过程中的真实改动。
    # marker 帧的 rating 通过 sub.parent.review_rating 反查:每个 sub 注入的 marker 都对应
    # 其直接前驱的评级;chain 多级时,parent 的 marker 不被复制,所以当前 sub 的所有 marker
    # 共享同一个 rating(就是 parent 的)。
    parent_rating: str | None = None
    if sub.parent_submission_id:
        parent = db.get(Submission, sub.parent_submission_id)
        if parent is not None:
            parent_rating = parent.review_rating

    raw_timeline = []
    for s in snapshots:
        kind = getattr(s, "kind", "code") or "code"
        node = {
            "t_offset_sec": s.t_offset_sec,
            "code": s.code,
            "code_hash": s.code_hash,
            "kind": kind,
        }
        if kind == "submit_marker":
            node["rating"] = parent_rating or "?"
        raw_timeline.append(node)

    sampled = _subsample_timeline(raw_timeline)
    timeline = _render_timeline(sampled)

    try:
        client = get_client()
    except LLMNotConfigured as e:
        log.warning("LLM not configured: %s", e)
        review = _fallback_review(f"LLM not configured: {e}", code="LLM_NOT_CONFIGURED")
        return ensure_review_meta(
            review,
            test_results,
            review_mode="llm",
            model=settings.LLM_MODEL,
        )
    return _do_review(
        client,
        problem,
        sub,
        timeline,
        test_results=test_results,
        on_progress=on_progress,
    )


def _do_review(
    client: LLMClient,
    problem: Problem,
    sub: Submission,
    timeline: list[dict],
    test_results: dict | None = None,
    on_progress: Callable[[str, dict | None], None] | None = None,
) -> dict:
    system = _system_prompt("review_system.md")
    language = sub.language or "python"
    schema = strict_json_schema(ReviewOutput)
    # json_schema 模式一旦建立，prompt 内嵌 schema 文本可省；建立前保留，
    # 保证协商中途降级到 json_object 的同 prompt 重试仍带结构说明。
    include_schema_in_prompt = not getattr(client, "json_schema_established", False)

    def render_user() -> str:
        return _render(
            "review_user.j2",
            problem=problem,
            language=language,
            reference_solution_md=_reference_for(problem, language),
            code=sub.code or "(empty)",
            timeline=timeline,
            elapsed_sec=sub.elapsed_sec,
            mode=sub.mode,
            mode_limit_sec=sub.mode_limit_sec,
            test_results=_render_test_results(test_results),
            schema_json=(
                json.dumps(
                    ReviewOutput.model_json_schema(), ensure_ascii=False, indent=2
                )
                if include_schema_in_prompt
                else None
            ),
        )

    user = render_user()
    model = _client_model(client)

    def meta(**overrides: Any) -> dict:
        # structured_output_mode 在所有 LLM 调用完成后取值 → 反映协商后的实际模式。
        base: dict[str, Any] = dict(
            review_mode="llm",
            model=model,
            structured_output_mode=getattr(client, "structured_output_mode", None),
        )
        base.update(overrides)
        return _review_meta(test_results, **base)

    def progress(stage: str, detail: dict | None = None) -> None:
        if on_progress is not None:
            on_progress(stage, detail)

    def sample_plan(rating: str, *, illegal_high: bool) -> int:
        if illegal_high:
            return 2
        if rating in ("B", "C"):
            return 3
        return 1

    first, fallback, invalid_retry_count = _primary_review(client, system, user, schema)
    if fallback is not None:
        progress(
            "llm_sampling",
            {"sample_k": 1, "sample_n": 1},
        )
        fallback["review_meta"] = meta(
            self_consistency_sample_count=0,
            sample_ratings=[],
            invalid_retry_count=invalid_retry_count,
        )
        return fallback
    assert first is not None

    consistency_warning = _consistency_warning(first, test_results)
    sample_ratings = [first.rating]
    first_illegal_high = _is_illegal_high_rating(first, test_results)
    planned_samples = sample_plan(first.rating, illegal_high=first_illegal_high)
    progress(
        "llm_sampling",
        {"sample_k": 1, "sample_n": planned_samples},
    )

    # guardrail：执行证据类硬约束。触发即早返回，确保 WRONG/TLE 结果不会给出高评级。
    if first_illegal_high:
        progress(
            "llm_sampling",
            {"sample_k": 2, "sample_n": planned_samples},
        )
        retry = _resample(client, system, user, schema)
        if retry is not None:
            sample_ratings.append(retry.rating)
            consistency_warning = consistency_warning or _consistency_warning(
                retry, test_results
            )
            if not _is_illegal_high_rating(retry, test_results):
                data = retry.model_dump()
                progress("guardrail", {"applied": True})
                data["review_meta"] = meta(
                    self_consistency_sample_count=len(sample_ratings),
                    sample_ratings=sample_ratings,
                    guardrail_applied=True,
                    invalid_retry_count=invalid_retry_count,
                    consistency_warning=consistency_warning,
                )
                return data
        data = _downgrade_to_c(first)
        progress("guardrail", {"applied": True})
        data["review_meta"] = meta(
            self_consistency_sample_count=len(sample_ratings),
            sample_ratings=sample_ratings,
            guardrail_applied=True,
            invalid_retry_count=invalid_retry_count,
            consistency_warning=consistency_warning,
        )
        return data

    # 采样策略：A/D 1 次；B/C 自一致 3 次多数投票
    # （方差最高、后果最重：7d vs 3d、是否解锁续编）。
    guardrail_applied = False
    if first.rating in ("B", "C"):
        samples = [first]
        for sample_k in range(2, 4):
            progress(
                "llm_sampling",
                {"sample_k": sample_k, "sample_n": planned_samples},
            )
            s = _resample(client, system, user, schema)
            if s is not None:
                samples.append(s)
                sample_ratings.append(s.rating)
                consistency_warning = consistency_warning or _consistency_warning(
                    s, test_results
                )
        winner = _conservative_majority([s.rating for s in samples])
        log.info(
            "B/C self-consistency: initial=%s ratings=%s -> final=%s (%d/3 samples ok)",
            first.rating,
            [s.rating for s in samples],
            winner,
            len(samples),
        )
        # 返回首个 rating == winner 的样本完整体，保 rating 与其 rationale/quality 自洽。
        chosen = next(s for s in samples if s.rating == winner)
        if _is_illegal_high_rating(chosen, test_results):
            data = _downgrade_to_c(chosen)
            progress("guardrail", {"applied": True})
            data["review_meta"] = meta(
                self_consistency_sample_count=len(sample_ratings),
                sample_ratings=sample_ratings,
                guardrail_applied=True,
                invalid_retry_count=invalid_retry_count,
                consistency_warning=consistency_warning,
            )
            return data
    else:
        # A/D（后果小、方差低）：单样本即胜出样本。
        chosen = first

    progress("guardrail", {"applied": guardrail_applied})

    data = chosen.model_dump()
    data["review_meta"] = meta(
        self_consistency_sample_count=len(sample_ratings),
        sample_ratings=sample_ratings,
        guardrail_applied=guardrail_applied,
        invalid_retry_count=invalid_retry_count,
        consistency_warning=consistency_warning,
    )
    return data


def _primary_review(
    client: LLMClient, system: str, user: str, schema: dict | None = None
) -> tuple[ReviewOutput | None, dict | None, int]:
    """主评测调用。JSON/schema invalid 只按同 prompt 轻重试一次。

    注意区分两类失败：端点能力错误的降级在 client 内部完成
    （对本函数透明）；这里的重试只处理"端点支持但这次输出不合规"。
    """
    invalid_retry_count = 0
    last_invalid_reason = "invalid output"
    for attempt in range(_MAX_INVALID_RETRIES + 1):
        try:
            raw = client.chat_json(
                system=system, user=user, temperature=0.2, max_tokens=2000, schema=schema
            )
        except LLMUnavailable as e:
            log.warning("LLM unavailable: %s", e)
            return (
                None,
                _fallback_review(f"LLM unavailable: {e}", code="LLM_UNAVAILABLE"),
                invalid_retry_count,
            )
        except LLMOutputInvalid as e:
            last_invalid_reason = f"LLM output invalid: {e}"
            log.warning("%s", last_invalid_reason)
            if attempt < _MAX_INVALID_RETRIES:
                invalid_retry_count += 1
                continue
            return (
                None,
                _fallback_review(last_invalid_reason, code="LLM_OUTPUT_INVALID"),
                invalid_retry_count,
            )

        try:
            return ReviewOutput.model_validate(raw), None, invalid_retry_count
        except ValidationError as e:
            last_invalid_reason = f"schema mismatch: {e.errors()[:3]}"
            log.warning("ReviewOutput schema mismatch: %s", e)
            if attempt < _MAX_INVALID_RETRIES:
                invalid_retry_count += 1
                continue
            return (
                None,
                _fallback_review(last_invalid_reason, code="LLM_OUTPUT_INVALID"),
                invalid_retry_count,
            )

    return (
        None,
        _fallback_review(last_invalid_reason, code="LLM_OUTPUT_INVALID"),
        invalid_retry_count,
    )


def _resample(
    client: LLMClient, system: str, user: str, schema: dict | None = None
) -> ReviewOutput | None:
    """B/C 补采样的一次调用：略升温求多样性；任何失败吞成 None，不影响主结果。"""
    try:
        raw = client.chat_json(
            system=system,
            user=user,
            temperature=_RESAMPLE_TEMPERATURE,
            max_tokens=2000,
            schema=schema,
        )
        return ReviewOutput.model_validate(raw)
    except (LLMUnavailable, LLMOutputInvalid, ValidationError) as e:
        log.warning("resample failed (ignored): %s", e)
        return None


def _fallback_review(reason: str, *, code: str = "REVIEW_FAILED") -> dict:
    return {
        "can_compile": False,
        "compile_issues": [],
        "quality": {"score": 5, "comments": "评测失败（AI 模型暂时不可用），无法判断"},
        "complexity": {"time": "?", "space": "?", "explain": ""},
        "optimization": [],
        "process_review": "本次评测失败，请用页面上的'重试评测'再试。",
        "rating": "C",
        "rating_rationale": "评测失败，未生成评分。",
        "error_code": code,
        "error": reason,
    }
