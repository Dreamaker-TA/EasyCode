"""从配置的 problems.json upsert 到 problem 表。

upsert 语义：
- source_path 不存在 → insert
- 存在但内容（statement / reference / title / is_core / category 等）有变 → update
- 完全相同 → 跳过
- 不删除"JSON 里没有但库里有"的题（避免误删历史关联）

4.4。
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

from sqlalchemy import select

from app.db.session import SessionLocal
from app.models import Problem
from app.settings import settings


def _normalize_str(s: str | None) -> str:
    return (s or "").rstrip()


def _problem_changed(p: Problem, payload: dict) -> bool:
    """对比关键字段是否变化（用于决定是否 UPDATE）。"""
    for k in (
        "leetcode_id",
        "external_id",
        "title",
        "category",
        "chapter_no",
        "problem_no",
        "is_core",
    ):
        if getattr(p, k) != payload.get(k):
            return True
    if _normalize_str(p.statement_md) != _normalize_str(payload.get("statement_md")):
        return True
    if _normalize_str(p.reference_solution_md) != _normalize_str(
        payload.get("reference_solution_md")
    ):
        return True
    if _normalize_str(p.grading_rubric_md) != _normalize_str(
        payload.get("grading_rubric_md")
    ):
        return True
    return False


def main(json_path: Path | None = None) -> int:
    json_path = json_path or settings.problems_json_path
    if not json_path.exists():
        print(f"[ERR] 未找到 {json_path}。先跑 scripts/ingest_problems.py。", file=sys.stderr)
        return 2

    payload_list: list[dict] = json.loads(json_path.read_text(encoding="utf-8"))
    print(f"读取 {len(payload_list)} 条候选题目自 {json_path}")

    inserted = updated = unchanged = 0
    with SessionLocal() as db:
        for payload in payload_list:
            existing = db.execute(
                select(Problem).where(Problem.source_path == payload["source_path"])
            ).scalar_one_or_none()
            if existing is None:
                db.add(
                    Problem(
                        leetcode_id=payload.get("leetcode_id"),
                        external_id=payload.get("external_id"),
                        title=payload["title"],
                        category=payload["category"],
                        chapter_no=payload["chapter_no"],
                        problem_no=payload["problem_no"],
                        is_core=bool(payload.get("is_core")),
                        statement_md=payload["statement_md"],
                        reference_solution_md=payload.get("reference_solution_md") or "",
                        grading_rubric_md=payload.get("grading_rubric_md"),
                        source_path=payload["source_path"],
                    )
                )
                inserted += 1
                continue
            if _problem_changed(existing, payload):
                existing.leetcode_id = payload.get("leetcode_id")
                existing.external_id = payload.get("external_id")
                existing.title = payload["title"]
                existing.category = payload["category"]
                existing.chapter_no = payload["chapter_no"]
                existing.problem_no = payload["problem_no"]
                existing.is_core = bool(payload.get("is_core"))
                existing.statement_md = payload["statement_md"]
                existing.reference_solution_md = payload.get("reference_solution_md") or ""
                existing.grading_rubric_md = payload.get("grading_rubric_md")
                updated += 1
            else:
                unchanged += 1
        db.commit()

    print(f"inserted={inserted} updated={updated} unchanged={unchanged}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
