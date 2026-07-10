"""测试用例边车解析 + 启动加载。

纯函数为主，可脱离 DB 复用。职责：
- ``parse_sidecar``：ingest 阶段读 + 校验单个 ``.tests.json``（fail-fast 点）。
- ``load_index`` / ``init_index`` / ``get_index``：启动时把 ``problems.json`` 的 tests
  字段加载为 ``dict[source_path -> TestSuite]`` 内存索引（零热路径 IO）。
- ``public_view``：对外响应的防泄过滤（仅样例暴露 stdin/expected_stdout）。
"""

from __future__ import annotations

import json
import logging
import re
from pathlib import Path
from typing import Any

from pydantic import ValidationError

from app.schemas.testcase import PublicTestCase, TestSuite

logger = logging.getLogger(__name__)

_TODO_COMMENT_RE = re.compile(r"(?m)^([ \t]*(?:#|//)\s*)TODO:\s*")


class TestSuiteError(ValueError):
    """边车格式非法（坏 JSON / 缺字段 / 非法值）。ingest 用其做 fail-fast。"""


def sidecar_path_for(md_source_path: str, repo_root: Path) -> Path:
    """由 .md 的 source_path 推导同名同目录 .tests.json 的绝对路径。

    显式替换 ``.md`` 后缀（不用 ``Path.with_suffix``，以免文件名含点时误伤）。
    """
    if md_source_path.endswith(".md"):
        rel = md_source_path[:-3] + ".tests.json"
    else:
        rel = md_source_path + ".tests.json"
    return repo_root / rel


def parse_sidecar(md_source_path: str, repo_root: Path) -> TestSuite | None:
    """读 + 校验一道题的边车。

    - 不存在 → ``None``（该题无执行接地，正常降级）
    - 坏 JSON / 校验失败 → ``raise TestSuiteError``（含相对路径 + 原因）
    """
    path = sidecar_path_for(md_source_path, repo_root)
    if not path.exists():
        return None
    rel = str(path.relative_to(repo_root))
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as e:
        raise TestSuiteError(f"{rel}: JSON 解析失败 — {e}") from e
    try:
        raw = _sanitize_suite_templates(raw)
        return TestSuite.model_validate(raw)
    except ValidationError as e:
        raise TestSuiteError(f"{rel}: 测试用例格式校验失败 —\n{e}") from e


def load_index(problems_json_path: Path) -> dict[str, TestSuite]:
    """从 problems.json 的 tests 字段构建 source_path -> TestSuite 索引。

    文件缺失 → ``{}``（优雅降级，全部题 has_tests=false）。产物已在 ingest 期校验过；
    此处对个别坏条目仍做防御：跳过并告警，不让单条坏数据拖垮整个启动。
    """
    if not problems_json_path.exists():
        return {}
    records = json.loads(problems_json_path.read_text(encoding="utf-8"))
    index: dict[str, TestSuite] = {}
    for rec in records:
        tests = rec.get("tests")
        if not tests:
            continue
        try:
            tests = _sanitize_suite_templates(tests)
            index[rec["source_path"]] = TestSuite.model_validate(tests)
        except ValidationError as e:
            logger.warning("跳过非法 tests 条目 %s：%s", rec.get("source_path"), e)
    return index


_INDEX: dict[str, TestSuite] | None = None


def init_index(problems_json_path: Path) -> None:
    """启动时填充模块级索引（main.py lifespan 调用）。"""
    global _INDEX
    _INDEX = load_index(problems_json_path)
    logger.info("已加载 %d 道题的测试用例索引", len(_INDEX))


def get_index() -> dict[str, TestSuite]:
    """返回当前索引；未初始化时返回空 dict（不抛错）。"""
    return _INDEX if _INDEX is not None else {}


def public_view(suite: TestSuite, reveal_hidden: bool = False) -> list[PublicTestCase]:
    """对外用例视图。

    默认（``reveal_hidden=False``）防泄：样例携带 stdin/expected_stdout/note，非样例仅
    id/is_sample（镜像 reference_solution_md 处理）。

    全量通道（``reveal_hidden=True``）：非样例也携带 stdin/expected_stdout，
    供前端 submit 时跑全量用例强化 grounding。**破防泄边界，仅本地单用户可接受**；由
    ``EXECUTOR`` flag 在路由层门控（EXECUTOR=none 时绝不开启）。note 仍仅样例暴露（纯展示用）。
    """
    out: list[PublicTestCase] = []
    for c in suite.cases:
        if c.is_sample:
            out.append(
                PublicTestCase(
                    id=c.id,
                    is_sample=True,
                    stdin=c.stdin,
                    expected_stdout=c.expected_stdout,
                    note=c.note,
                )
            )
        elif reveal_hidden:
            out.append(
                PublicTestCase(
                    id=c.id,
                    is_sample=False,
                    stdin=c.stdin,
                    expected_stdout=c.expected_stdout,
                )
            )
        else:
            out.append(PublicTestCase(id=c.id, is_sample=False))
    return out


def _sanitize_suite_templates(raw: Any) -> Any:
    """Remove internal TODO markers from user-facing starter templates."""
    if not isinstance(raw, dict):
        return raw
    templates = raw.get("templates")
    if not isinstance(templates, dict):
        return raw
    cleaned = {
        lang: _sanitize_template_text(text) if isinstance(text, str) else text
        for lang, text in templates.items()
    }
    return {**raw, "templates": cleaned}


def _sanitize_template_text(text: str) -> str:
    return _TODO_COMMENT_RE.sub(r"\1", text)
