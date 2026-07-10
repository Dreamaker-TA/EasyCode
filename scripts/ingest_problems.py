"""题库摄取脚本。

扫描题库目录下的 Code/**/*.md，按规则切分为题面 / 参考解，产出 problems.json。

用法：
  python scripts/ingest_problems.py [--dry-run] [--verbose] [--bank-root PATH] [--out PATH]
"""

from __future__ import annotations

import argparse
import json
import sys
from collections import Counter
from pathlib import Path

# 允许在仓库根直接执行而不需要安装为包
SCRIPT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPT_DIR.parent))
# backend/ 上 path，以便复用 app.services.testcase_loader（ingest 经 `cd backend && uv run`
# 在 backend env 运行，见 Makefile）——让摄取与其他题库工具复用同一份校验逻辑。
sys.path.insert(0, str(SCRIPT_DIR.parent / "backend"))

from scripts.problem_parser import (  # noqa: E402
    iter_md_files,
    parse_file,
    split_markdown,
)
from app.services.testcase_loader import TestSuiteError, parse_sidecar  # noqa: E402
from app.settings import settings  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(description="题库摄取脚本")
    parser.add_argument("--dry-run", action="store_true", help="只统计不写文件")
    parser.add_argument("--verbose", action="store_true", help="打印每文件切分点")
    parser.add_argument(
        "--bank-root",
        default=None,
        help="题库根目录（其中应包含 Code/）；默认读 EASYCODE_PROBLEM_BANK_ROOT",
    )
    parser.add_argument(
        "--out",
        default=None,
        help="输出 JSON 路径；默认读 EASYCODE_PROBLEMS_JSON_PATH",
    )
    args = parser.parse_args()

    repo_root = SCRIPT_DIR.parent
    bank_root = _resolve_cli_path(args.bank_root) if args.bank_root else settings.problem_bank_root_path
    code_root = bank_root / "Code"
    if not code_root.is_dir():
        print(f"[ERR] 未找到 Code/ 目录：{code_root}", file=sys.stderr)
        return 2

    skipped: list[tuple[str, str]] = []
    parsed: list[dict] = []
    parse_errors: list[tuple[str, str]] = []
    test_errors: list[str] = []  # .tests.json 边车校验失败（fail-fast，见末尾）

    for path in iter_md_files(code_root):
        rel = str(path.relative_to(bank_root))
        try:
            problem = parse_file(path, bank_root)
        except Exception as e:  # noqa: BLE001 — 兜底，避免单文件出错让整批失败
            parse_errors.append((rel, f"{type(e).__name__}: {e}"))
            print(f"[ERR ] {rel}  {e}", file=sys.stderr)
            continue

        if problem is None:
            skipped.append((rel, "无 ## 题目描述"))
            if args.verbose:
                print(f"[SKIP] {rel}  (无 ## 题目描述)")
            continue

        # 执行接地测试用例边车：存在则解析+校验，附到产物的 tests 字段。
        # 坏边车收集后在末尾 fail-fast；缺边车 = 正常（该题无执行接地）。
        record = problem.to_dict()
        rubric = _read_rubric_sidecar(problem.source_path, bank_root)
        if rubric:
            record["grading_rubric_md"] = rubric
        try:
            suite = parse_sidecar(problem.source_path, bank_root)
        except TestSuiteError as e:
            test_errors.append(str(e))
            print(f"[ERR ] {e}", file=sys.stderr)
            suite = None
        if suite is not None:
            record["tests"] = suite.model_dump()
        parsed.append(record)

        if args.verbose:
            text = path.read_text(encoding="utf-8-sig")
            _, _, meta = split_markdown(text)
            tests_note = ""
            if suite is not None:
                n_sample = sum(1 for c in suite.cases if c.is_sample)
                tests_note = f"  tests={len(suite.cases)}({n_sample} sample)"
            print(
                f"[OK  ] {rel}  "
                f"H1@{meta['first_h1_line']} "
                f"题面@{meta['statement_start_line']} "
                f"参考解@{meta['reference_start_line']}  "
                f"id={problem.leetcode_id or problem.external_id}  "
                f"★={problem.is_core}{tests_note}"
            )

    # === 统计 ===
    total = len(parsed)
    core_count = sum(1 for p in parsed if p["is_core"])
    by_cat = Counter(p["category"] for p in parsed)
    missing_leetcode = sum(1 for p in parsed if p["leetcode_id"] is None)
    missing_both_ids = sum(
        1 for p in parsed if p["leetcode_id"] is None and not p["external_id"]
    )

    print()
    print("=" * 60)
    print(f"摄取完成：{total} 道题（★ 核心题 {core_count} 道）")
    print(f"  跳过 {len(skipped)} 文件，解析失败 {len(parse_errors)} 文件")
    print(f"  无 LeetCode 编号 {missing_leetcode}（其中无 external_id 也 {missing_both_ids}）")
    print()
    print("分章节：")
    for cat, n in sorted(by_cat.items()):
        print(f"  {cat:<6}  {n}")
    print("=" * 60)

    if parse_errors:
        print("[WARN] 解析失败列表：")
        for f, msg in parse_errors:
            print(f"  - {f}: {msg}")

    # === 测试用例边车 fail-fast：坏边车一律不写产物，报明确错不静默 ===
    if test_errors:
        print(
            f"\n[FATAL] {len(test_errors)} 个 .tests.json 边车校验失败：",
            file=sys.stderr,
        )
        for msg in test_errors:
            print(f"  - {msg}", file=sys.stderr)
        print("修复后重跑；未写产物（fail-fast）。", file=sys.stderr)
        return 1

    if args.dry_run:
        print("\n(dry-run，未写文件)")
        return 0

    out_path = _resolve_cli_path(args.out) if args.out else settings.problems_json_path
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(parsed, ensure_ascii=False, indent=2), encoding="utf-8")
    size_kb = out_path.stat().st_size / 1024
    print(f"\n已写入 {out_path} ({size_kb:.1f} KB)")
    return 0


def _resolve_cli_path(value: str) -> Path:
    path = Path(value).expanduser()
    if path.is_absolute():
        return path
    return SCRIPT_DIR.parent / path


def _read_rubric_sidecar(md_source_path: str, bank_root: Path) -> str:
    rel = md_source_path[:-3] + ".rubric.md" if md_source_path.endswith(".md") else md_source_path + ".rubric.md"
    path = bank_root / rel
    if not path.exists():
        return ""
    return path.read_text(encoding="utf-8-sig").strip() + "\n"


if __name__ == "__main__":
    raise SystemExit(main())
