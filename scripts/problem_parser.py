"""题库 markdown 解析的纯函数集合。

切分规则以本模块实现与示例题库为准。
"""

from __future__ import annotations

import re
from dataclasses import dataclass, asdict
from pathlib import Path
from typing import Iterable

# 一级标题：带力扣序号或不带序号，末尾可有 ★。
TITLE_RE_LEETCODE = re.compile(r"^#\s+(\d+)\.\s+(.+?)\s*(★)?\s*$")
TITLE_RE_PLAIN = re.compile(r"^#\s+(.+?)\s*(★)?\s*$")

# === 文件名正则 ===
FILENAME_RE_LEETCODE = re.compile(r"^(\d+)_(\d{3,4})_(.+)\.md$")
FILENAME_RE_FALLBACK = re.compile(r"^(\d+)_(.+)\.md$")

# === 章节目录正则 ===
CATEGORY_RE = re.compile(r"^(\d+)_(.+)$")


@dataclass
class Problem:
    leetcode_id: int | None
    external_id: str | None
    title: str
    is_core: bool
    category: str
    chapter_no: int
    problem_no: int
    statement_md: str
    reference_solution_md: str
    source_path: str

    def to_dict(self) -> dict:
        return asdict(self)


# === 标题与文件名解析 ===


def parse_title_line(line: str) -> dict:
    """解析带力扣序号或普通一级标题。"""
    m = TITLE_RE_LEETCODE.match(line)
    if m:
        return {
            "leetcode_id": int(m.group(1)),
            "title": m.group(2).strip(),
            "is_core": m.group(3) is not None,
        }
    m = TITLE_RE_PLAIN.match(line)
    if m:
        return {
            "leetcode_id": None,
            "title": m.group(1).strip(),
            "is_core": m.group(2) is not None,
        }
    return {
        "leetcode_id": None,
        "title": "",
        "is_core": False,
    }


def parse_filename(name: str) -> dict:
    """从文件名抽取 problem_no / leetcode_id。"""
    m = FILENAME_RE_LEETCODE.match(name)
    if m:
        return {
            "problem_no": int(m.group(1)),
            "leetcode_id": int(m.group(2)),
            "external_id": None,
        }
    m = FILENAME_RE_FALLBACK.match(name)
    if m:
        return {
            "problem_no": int(m.group(1)),
            "leetcode_id": None,
            "external_id": None,
        }
    return {"problem_no": -1, "leetcode_id": None, "external_id": None}


def parse_category(dir_name: str) -> tuple[int, str]:
    """从章节目录名提取 (chapter_no, category)。"""
    m = CATEGORY_RE.match(dir_name)
    if m:
        return int(m.group(1)), m.group(2)
    return -1, dir_name


# === 切分主逻辑 ===


def split_markdown(text: str) -> tuple[str | None, str | None, dict]:
    """按规则切分 markdown 文本。

    返回 (statement_md, reference_md, meta)。
    - statement_md 包含 "## 题目描述" 标题行
    - reference_md 不包含 "## 题目描述"，从下一个 ## 标题开始
    - meta 含 {first_h1_line, statement_start_line, reference_start_line}
      行号从 1 开始
    """
    lines = text.splitlines()
    # 找一级标题
    first_h1_line = -1
    for i, line in enumerate(lines):
        if line.startswith("# "):
            first_h1_line = i + 1
            break

    # 找 "## 题目描述" 和下一个 "## "，注意代码围栏感知
    in_fence = False
    statement_start = -1
    reference_start = -1

    for i, line in enumerate(lines):
        stripped = line.lstrip()
        # 代码围栏：``` 或 ~~~
        if stripped.startswith("```") or stripped.startswith("~~~"):
            in_fence = not in_fence
            continue
        if in_fence:
            continue
        if line.startswith("## "):
            # 题目描述本身
            if statement_start == -1 and line.strip().startswith("## 题目描述"):
                statement_start = i + 1
                continue
            # 题目描述之后第一个 ## 即参考解起点
            if statement_start != -1 and reference_start == -1:
                reference_start = i + 1

    meta = {
        "first_h1_line": first_h1_line,
        "statement_start_line": statement_start,
        "reference_start_line": reference_start,
    }

    if statement_start == -1:
        return None, None, meta

    if reference_start == -1:
        # 整篇都是题面（没有解题章节），参考解为空
        statement_md = "\n".join(lines[statement_start - 1 :]).rstrip() + "\n"
        return statement_md, "", meta

    statement_md = "\n".join(lines[statement_start - 1 : reference_start - 1]).rstrip() + "\n"
    reference_md = "\n".join(lines[reference_start - 1 :]).rstrip() + "\n"
    return statement_md, reference_md, meta


# === 顶层 ===


def parse_file(path: Path, repo_root: Path) -> Problem | None:
    """完整解析一个 md 文件。返回 Problem 或 None（应跳过 / 解析失败）。"""
    text = path.read_text(encoding="utf-8-sig")

    # 标题
    title_info = {"leetcode_id": None, "title": "", "is_core": False}
    for line in text.splitlines():
        if line.startswith("# "):
            title_info = parse_title_line(line)
            break

    # 文件名
    fname_info = parse_filename(path.name)

    # 章节
    chapter_no, category = parse_category(path.parent.name)

    # 切分
    statement_md, reference_md, _ = split_markdown(text)
    if statement_md is None:
        return None

    # 合并：标题优先，文件名兜底
    leetcode_id = title_info["leetcode_id"] or fname_info["leetcode_id"]
    external_id = fname_info["external_id"]

    title = title_info["title"] or path.stem

    return Problem(
        leetcode_id=leetcode_id,
        external_id=external_id,
        title=title,
        is_core=title_info["is_core"],
        category=category,
        chapter_no=chapter_no,
        problem_no=fname_info["problem_no"],
        statement_md=statement_md,
        reference_solution_md=reference_md or "",
        source_path=str(path.relative_to(repo_root)),
    )


def iter_md_files(code_root: Path) -> Iterable[Path]:
    """按文件名排序返回所有题目 .md（不含 rubric 边车）。"""
    return sorted(p for p in code_root.rglob("*.md") if not p.name.endswith(".rubric.md"))
