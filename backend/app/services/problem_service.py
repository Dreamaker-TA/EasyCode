"""题目查询服务（无写入）。"""

from __future__ import annotations

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.models import Mastery, Problem
from app.schemas.problem import MasteryView
from app.services import srs_service
from app.services import testcase_loader


def supported_languages(problem: Problem) -> list[str]:
    """该题可写/可评的语言集。

    JavaScript 已整体下线（无本地执行接地、覆盖率过低、体验割裂），现仅支持 Python；
    create_draft 据此守门，拒绝任何非 Python 语言。
    """
    return ["python"]


def _build_filter(stmt, category: str | None, core_only: bool, q: str | None):
    if category:
        stmt = stmt.where(Problem.category == category)
    if core_only:
        stmt = stmt.where(Problem.is_core.is_(True))
    if q:
        like = f"%{q}%"
        # leetcode_id 是 int，转为 string 后 LIKE
        stmt = stmt.where(
            or_(
                Problem.title.like(like),
                func.cast(Problem.leetcode_id, type_=Problem.title.type).like(like),
            )
        )
    return stmt


def list_problems(
    db: Session,
    *,
    category: str | None = None,
    core_only: bool = False,
    q: str | None = None,
    limit: int = 500,
    offset: int = 0,
) -> tuple[list[dict], int]:
    """返回 (items, total)。每个 item 是 dict（含可空 mastery）。"""
    base = select(Problem)
    base = _build_filter(base, category, core_only, q)

    total = db.execute(
        select(func.count()).select_from(base.subquery())
    ).scalar_one()

    stmt = (
        base.order_by(Problem.chapter_no.asc(), Problem.problem_no.asc())
        .limit(limit)
        .offset(offset)
    )
    problems = db.execute(stmt).scalars().all()

    # 拉同一批的 mastery（LEFT JOIN 风格）
    pids = [p.id for p in problems]
    mastery_map: dict[int, Mastery] = {}
    if pids:
        rows = db.execute(select(Mastery).where(Mastery.problem_id.in_(pids))).scalars().all()
        mastery_map = {m.problem_id: m for m in rows}

    items: list[dict] = []
    for p in problems:
        items.append(
            {
                "id": p.id,
                "leetcode_id": p.leetcode_id,
                "external_id": p.external_id,
                "title": p.title,
                "category": p.category,
                "chapter_no": p.chapter_no,
                "problem_no": p.problem_no,
                "is_core": p.is_core,
                "mastery": _mastery_view(mastery_map.get(p.id)),
            }
        )
    return items, int(total)


def get_problem(db: Session, problem_id: int) -> dict | None:
    p = db.get(Problem, problem_id)
    if p is None:
        return None
    m = db.execute(select(Mastery).where(Mastery.problem_id == p.id)).scalar_one_or_none()
    return {
        "id": p.id,
        "leetcode_id": p.leetcode_id,
        "external_id": p.external_id,
        "title": p.title,
        "category": p.category,
        "chapter_no": p.chapter_no,
        "problem_no": p.problem_no,
        "is_core": p.is_core,
        "statement_md": p.statement_md,
        "supported_languages": supported_languages(p),
        "mastery": _mastery_view(m),
        "last_submission_id": m.last_submission_id if m else None,
    }


def get_tests_view(db: Session, problem_id: int, reveal_hidden: bool = False) -> dict | None:
    """GET /problems/{id}/tests 的响应 dict；题目不存在返回 None（路由转 404）。

    source_path 仅在此内部用于查 tests 索引，**绝不进响应**（防泄，镜像
    reference_solution_md 的处理）。无边车 → has_tests=false（不报错）。

    ``reveal_hidden=True`` 走全量通道：非样例 I/O 一并下发，由路由层据
    ``EXECUTOR`` flag 门控（详见 testcase_loader.public_view）。
    """
    p = db.get(Problem, problem_id)
    if p is None:
        return None
    suite = testcase_loader.get_index().get(p.source_path)
    if suite is None:
        return {
            "problem_id": problem_id,
            "has_tests": False,
            "checker": None,
            "time_limit_ms": None,
            "cases": [],
            "templates": {},
        }
    return {
        "problem_id": problem_id,
        "has_tests": True,
        "checker": suite.checker,
        "time_limit_ms": suite.time_limit_ms,
        "cases": testcase_loader.public_view(suite, reveal_hidden=reveal_hidden),
        "templates": suite.templates,
    }


def _mastery_view(m: Mastery | None) -> dict | None:
    if m is None:
        return None
    return MasteryView(
        effective_rating=srs_service.effective_rating(m),
        user_rating=m.user_rating,
        auto_rating=m.auto_rating,
    ).model_dump()
