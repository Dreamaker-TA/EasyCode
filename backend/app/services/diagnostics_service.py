"""Read-only environment diagnostics for local product setup."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit

from sqlalchemy import func, select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.db.session import DB_PATH
from app.models import Problem
from app.settings import PROJECT_ROOT, settings
from app.services import submission_service, testcase_loader

VERSION = "0.0.1"
REQUIRED_PROBLEM_FIELDS = {
    "title",
    "category",
    "chapter_no",
    "problem_no",
    "statement_md",
    "source_path",
}


def get_diagnostics(db: Session) -> dict:
    database_ok, seeded_count, last_seeded_at, db_error = _database_state(db)
    material = _advanced_material_state(db) if database_ok else _empty_material_state()
    problems = _problems_state(
        seeded_count=seeded_count,
        last_seeded_at=last_seeded_at,
        rubric_problem_count=material["rubric_problem_count"],
    )
    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "runtime": _runtime_state(database_ok=database_ok, db_error=db_error),
        "review": _review_state(db, database_ok=database_ok, db_error=db_error),
        "execution": _execution_state(),
        "problems": problems,
    }


def _runtime_state(*, database_ok: bool, db_error: str | None) -> dict:
    database_size = DB_PATH.stat().st_size if DB_PATH.exists() else None
    checks = [
        {
            "label": "后端服务",
            "status": "ok",
            "message": "FastAPI 已响应诊断请求。",
            "recovery": None,
        },
        {
            "label": "数据库",
            "status": "ok" if database_ok else "error",
            "message": "SQLite 可查询。" if database_ok else f"SQLite 查询失败：{db_error}",
            "recovery": None
            if database_ok
            else "运行 `cd backend && uv run alembic upgrade head`，必要时再执行 `make seed`。",
        },
    ]
    if not DB_PATH.exists():
        checks.append(
            {
                "label": "数据库文件",
                "status": "warn",
                "message": "默认数据库文件尚未出现；如果当前使用内存库或自定义 DB_PATH 可忽略。",
                "recovery": "运行 `make migrate && make seed` 生成本地 SQLite 数据库。",
            }
        )
    return {
        "version": VERSION,
        "backend_ok": True,
        "database_ok": database_ok,
        "database_path": _relpath(DB_PATH),
        "database_size_bytes": database_size,
        "cors_origins": settings.cors_origins_list,
        "api_base_hint": "http://127.0.0.1:8000/api",
        "checks": checks,
    }


def _review_state(
    db: Session,
    *,
    database_ok: bool = True,
    db_error: str | None = None,
) -> dict:
    key_configured = bool(settings.LLM_API_KEY.strip())
    local_no_key_ok = _is_local_endpoint(settings.LLM_BASE_URL)
    masked_base_url = _safe_url(settings.LLM_BASE_URL)
    provider = _infer_provider(settings.LLM_BASE_URL)
    queue_error = None
    queue = {
        "pending_review_count": 0,
        "stale_review_count": 0,
        "review_stale_after_sec": int(submission_service.REVIEW_STALE_AFTER.total_seconds()),
        "oldest_review_started_at": None,
    }
    if database_ok:
        try:
            queue = submission_service.review_queue_state(db)
        except SQLAlchemyError as exc:
            queue_error = str(exc)
    else:
        queue_error = db_error
    checks = [
        {
            "label": "评测模式",
            "status": "ok",
            "message": "当前会使用兼容 OpenAI 格式的 AI 模型服务。",
            "recovery": None,
        }
    ]
    checks.append(
        {
            "label": "模型访问密钥",
            "status": "ok" if key_configured or local_no_key_ok else "error",
            "message": "已配置密钥。"
            if key_configured
            else ("本地模型服务可不填访问密钥。" if local_no_key_ok else "缺少模型访问密钥。"),
            "recovery": None
            if key_configured or local_no_key_ok
            else "在 `.env` 中填写 `LLM_API_KEY` 后重启服务。",
        }
    )
    checks.append(
        {
            "label": "模型",
            "status": "ok" if settings.LLM_MODEL.strip() else "error",
            "message": settings.LLM_MODEL.strip() or "尚未设置模型名称。",
            "recovery": None
            if settings.LLM_MODEL.strip()
            else "在 `.env` 中填写 `LLM_MODEL` 后重启服务。",
        }
    )
    pending = queue["pending_review_count"]
    stale = queue["stale_review_count"]
    if queue_error:
        checks.append(
            {
                "label": "评测队列",
                "status": "error",
                "message": f"评测队列暂时不可查询：{queue_error}",
                "recovery": "运行 `cd backend && uv run alembic upgrade head`，必要时再执行 `make seed`。",
            }
        )
    else:
        checks.append(
            {
                "label": "评测队列",
                "status": "error" if stale else ("warn" if pending else "ok"),
                "message": (
                    f"{pending} 条评测仍在进行，其中 {stale} 条已超过 "
                    f"{queue['review_stale_after_sec'] // 60} 分钟恢复阈值。"
                )
                if pending
                else "当前没有等待中的异步评测。",
                "recovery": "重启后端会把超时评测标为可重试；也可以回到提交页面点击“重试评测”。"
                if stale
                else None,
            }
        )
    return {
        "mode": "llm",
        "llm_key_configured": key_configured,
        "llm_base_url": masked_base_url,
        "llm_model": settings.LLM_MODEL,
        "llm_provider": provider,
        **queue,
        "checks": checks,
    }


def _execution_state() -> dict:
    pyodide_assets_present = _pyodide_assets_present()
    testcase_problem_count = len(testcase_loader.get_index())
    executor_enabled = settings.EXECUTOR != "none"
    checks = [
        {
            "label": "执行器",
            "status": "ok" if executor_enabled else "warn",
            "message": "执行接地已开启：前端可预跑，提交时后端会复跑测试。"
            if executor_enabled
            else "本地测试已关闭，提交时只进行 AI 评测。",
            "recovery": None
            if executor_enabled
            else "将 `.env` 中 `EXECUTOR=pyodide`；前端会从 `/api/meta` 自动同步该设置。",
        },
        {
            "label": "浏览器内 Python 运行环境",
            "status": "ok" if pyodide_assets_present else "warn",
            "message": "浏览器内 Python 运行环境已准备好。"
            if pyodide_assets_present
            else "浏览器内 Python 运行环境尚未准备好；开发环境可能还没有安装前端依赖。",
            "recovery": None
            if pyodide_assets_present
            else "运行 `cd frontend && pnpm install`，构建时再执行 `pnpm build`。",
        },
        {
            "label": "可运行测试覆盖",
            "status": "ok" if testcase_problem_count >= 8 else "warn",
            "message": f"{testcase_problem_count} 道题带可执行测试用例。",
            "recovery": None
            if testcase_problem_count >= 8
            else "为核心题补 `.tests.json` 后运行 `make ingest`；最终提交建议至少 8 道。",
        },
    ]
    return {
        "executor": settings.EXECUTOR,
        "pyodide_assets_present": pyodide_assets_present,
        "testcase_problem_count": testcase_problem_count,
        "checks": checks,
    }


def _problems_state(
    *,
    seeded_count: int,
    last_seeded_at: str | None,
    rubric_problem_count: int,
) -> dict:
    code_root = settings.code_root_path
    problems_json = settings.problems_json_path
    source_files = _count_source_files(code_root)
    parsed_count, errors = _read_generated_problems(problems_json)
    last_generated_at = _mtime_iso(problems_json)
    checks = []
    checks.append(
        {
            "label": "题库源目录",
            "status": "ok" if code_root.is_dir() else "error",
            "message": f"扫描到 {source_files} 个 Markdown 源文件。"
            if code_root.is_dir()
            else "未找到 Code/ 目录。",
            "recovery": None
            if code_root.is_dir()
            else "设置 `EASYCODE_PROBLEM_BANK_ROOT` 指向包含 `Code/` 的题库目录。",
        }
    )
    checks.append(
        {
            "label": "摄取产物",
            "status": "ok" if parsed_count > 0 and not errors else ("error" if errors else "warn"),
            "message": f"problems.json 中有 {parsed_count} 道题。"
            if parsed_count > 0
            else "未生成可用的 problems.json。",
            "recovery": None
            if parsed_count > 0 and not errors
            else "运行 `make ingest`；若仍失败，修复下方格式错误后重试。",
        }
    )
    checks.append(
        {
            "label": "数据库题目",
            "status": "ok" if seeded_count == parsed_count and seeded_count > 0 else "warn",
            "message": f"数据库中有 {seeded_count} 道题，已导入的题目文件中有 {parsed_count} 道题。",
            "recovery": None
            if seeded_count == parsed_count and seeded_count > 0
            else "运行 `make seed` 将当前 problems.json 同步到数据库。",
        }
    )
    checks.append(
        {
            "label": "评分要求覆盖",
            "status": "ok" if rubric_problem_count > 0 else "warn",
            "message": f"{rubric_problem_count} 道题已配置评分要求。",
            "recovery": None
            if rubric_problem_count > 0
            else "在题库中添加同名 `.rubric.md` 评分要求文件后运行 `make ingest`。",
        }
    )
    return {
        "source_path": _relpath(code_root),
        "source_files": source_files,
        "parsed_count": parsed_count,
        "seeded_count": seeded_count,
        "rubric_problem_count": rubric_problem_count,
        "last_generated_at": last_generated_at,
        "last_seeded_at": last_seeded_at,
        "errors": errors[:10],
        "checks": checks,
    }


def _database_state(db: Session) -> tuple[bool, int, str | None, str | None]:
    try:
        seeded_count = int(db.execute(select(func.count(Problem.id))).scalar_one())
        last_seeded = db.execute(select(func.max(Problem.updated_at))).scalar_one()
    except SQLAlchemyError as exc:
        return False, 0, None, str(exc)
    return True, seeded_count, _dt_iso(last_seeded), None


def _advanced_material_state(db: Session) -> dict:
    try:
        rows = db.execute(select(Problem.grading_rubric_md)).all()
    except SQLAlchemyError:
        return _empty_material_state()
    rubric_problem_count = sum(1 for (rubric,) in rows if (rubric or "").strip())
    return {
        "rubric_problem_count": rubric_problem_count,
    }


def _empty_material_state() -> dict:
    return {
        "rubric_problem_count": 0,
    }


def _read_generated_problems(path: Path) -> tuple[int, list[dict]]:
    if not path.exists():
        return 0, [{"source": _relpath(path), "message": "文件不存在。"}]
    try:
        records = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        return 0, [{"source": _relpath(path), "message": f"JSON 解析失败：{exc}"}]
    if not isinstance(records, list):
        return 0, [{"source": _relpath(path), "message": "顶层结构必须是数组。"}]
    errors: list[dict] = []
    for idx, rec in enumerate(records):
        if not isinstance(rec, dict):
            errors.append({"source": f"{_relpath(path)}[{idx}]", "message": "题目记录必须是对象。"})
            continue
        missing = sorted(REQUIRED_PROBLEM_FIELDS - set(rec))
        if missing:
            source = str(rec.get("source_path") or f"{_relpath(path)}[{idx}]")
            errors.append({"source": source, "message": f"缺少字段：{', '.join(missing)}"})
    return len(records), errors


def _count_source_files(code_root: Path) -> int:
    if not code_root.is_dir():
        return 0
    return sum(1 for path in code_root.rglob("*.md") if path.is_file())


def _pyodide_assets_present() -> bool:
    names = ("pyodide.mjs", "pyodide.asm.mjs", "pyodide.asm.wasm")
    candidates = (
        PROJECT_ROOT / "frontend/node_modules/pyodide",
        PROJECT_ROOT / "frontend/dist/pyodide",
    )
    return any(all((candidate / name).exists() for name in names) for candidate in candidates)


def _safe_url(value: str) -> str:
    parsed = urlsplit(value)
    if not parsed.scheme or not parsed.netloc:
        return value.split("?")[0]
    host = parsed.hostname or ""
    netloc = host
    if parsed.port:
        netloc = f"{netloc}:{parsed.port}"
    return urlunsplit((parsed.scheme, netloc, parsed.path.rstrip("/"), "", ""))


def _is_local_endpoint(value: str) -> bool:
    host = (urlsplit(value).hostname or "").lower()
    return host in {"localhost", "127.0.0.1", "0.0.0.0", "::1"}


def _infer_provider(base_url: str) -> str:
    host = (urlsplit(base_url).hostname or base_url).lower()
    if "deepseek" in host:
        return "deepseek"
    if "openai" in host:
        return "openai"
    if "localhost" in host or host.startswith("127."):
        return "local"
    return "custom"


def _mtime_iso(path: Path) -> str | None:
    if not path.exists():
        return None
    return datetime.fromtimestamp(path.stat().st_mtime, tz=timezone.utc).isoformat()


def _dt_iso(value: object) -> str | None:
    if isinstance(value, datetime):
        if value.tzinfo is None:
            value = value.replace(tzinfo=timezone.utc)
        return value.isoformat()
    return None


def _relpath(path: Path) -> str:
    try:
        return str(path.relative_to(PROJECT_ROOT))
    except ValueError:
        return str(path)
