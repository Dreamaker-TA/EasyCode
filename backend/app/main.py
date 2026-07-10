"""EasyCode FastAPI 应用入口。"""

from __future__ import annotations

import mimetypes
from contextlib import asynccontextmanager

import logging

from fastapi import FastAPI, HTTPException, Request
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from app.api import history as history_api
from app.api import diagnostics as diagnostics_api
from app.api import mastery as mastery_api
from app.api import meta as meta_api
from app.api import problems as problems_api
from app.api import review_events as review_events_api
from app.api import reviews as reviews_api
from app.api import srs as srs_api
from app.api import stats as stats_api
from app.api import submissions as submissions_api
from app.api import tutor as tutor_api
from app.api import training as training_api
from app.api import user_settings as user_settings_api
from app.services import submission_service, testcase_loader
from app.settings import PROJECT_ROOT, settings

# Pyodide 自托管资源 MIME：.wasm 在 Python 3.11 的 mimetypes 默认缺失，而 pyodide 的
# instantiateStreaming 强制要 application/wasm；/pyodide/*.mjs 运行时被 import() 需 JS MIME。
mimetypes.add_type("application/wasm", ".wasm")
mimetypes.add_type("text/javascript", ".mjs")

log = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(_: FastAPI):
    # 启动加载执行接地测试用例到内存索引（免 Problem 迁移、零热路径 IO）。
    testcase_loader.init_index(settings.problems_json_path)
    with submission_service.SessionLocal() as db:
        recovered = submission_service.recover_stale_reviews(db)
        if recovered:
            log.warning("Recovered %s stale async review(s) at startup", recovered)
    yield


app = FastAPI(title="EasyCode Backend", version="0.0.1", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


# === 统一错误响应：{"error": {code, message, details}} ===


@app.exception_handler(HTTPException)
async def _http_exception_handler(_: Request, exc: HTTPException) -> JSONResponse:
    # 若 detail 已经是 {"error": {...}} 结构，直接展开；否则包装
    if isinstance(exc.detail, dict) and "error" in exc.detail:
        body = exc.detail
    else:
        body = {
            "error": {
                "code": "HTTP_ERROR",
                "message": str(exc.detail),
                "details": {},
            }
        }
    return JSONResponse(status_code=exc.status_code, content=body)


@app.exception_handler(RequestValidationError)
async def _validation_exception_handler(_: Request, exc: RequestValidationError) -> JSONResponse:
    return JSONResponse(
        status_code=422,
        content={
            "error": {
                "code": "VALIDATION_ERROR",
                "message": "Request validation failed",
                "details": {"errors": jsonable_encoder(exc.errors())},
            }
        },
    )


@app.exception_handler(Exception)
async def _unhandled_exception_handler(_: Request, exc: Exception) -> JSONResponse:
    log.exception("Unhandled backend error: %s", exc)
    return JSONResponse(
        status_code=500,
        content={
            "error": {
                "code": "INTERNAL_ERROR",
                "message": "Internal server error",
                "details": {},
            }
        },
    )


@app.get("/healthz")
def healthz() -> dict:
    return {"status": "ok", "version": "0.0.1"}


# === 业务路由 ===
app.include_router(problems_api.router, prefix="/api")
app.include_router(submissions_api.router, prefix="/api")
app.include_router(reviews_api.router, prefix="/api")
app.include_router(review_events_api.router, prefix="/api")
app.include_router(tutor_api.router, prefix="/api")
app.include_router(mastery_api.router, prefix="/api")
app.include_router(srs_api.router, prefix="/api")
app.include_router(history_api.router, prefix="/api")
app.include_router(diagnostics_api.router, prefix="/api")
app.include_router(meta_api.router, prefix="/api")
app.include_router(training_api.router, prefix="/api")
app.include_router(stats_api.router, prefix="/api")
app.include_router(user_settings_api.router, prefix="/api")


# === 前端静态资源：单容器同源服务 dist===
# 仅当构建产物存在时挂载——本地 dev（无 dist，前端走 vite）不受影响。
# /api 业务路由、/healthz、/docs 均在本段之前注册，优先级高于下面的 SPA 兜底。
_DIST_DIR = PROJECT_ROOT / "frontend" / "dist"
if _DIST_DIR.is_dir():
    # 哈希命名构建资源 + 自托管 pyodide 运行时（*.wasm/*.mjs 已在顶部注册正确 MIME）。
    # check_dir=False：dist 不完整也不让启动崩溃，缺失路径回 404 即可。
    app.mount("/assets", StaticFiles(directory=_DIST_DIR / "assets", check_dir=False), name="assets")
    app.mount("/pyodide", StaticFiles(directory=_DIST_DIR / "pyodide", check_dir=False), name="pyodide")

    _INDEX_HTML = _DIST_DIR / "index.html"
    _INDEX_HEADERS = {
        "Cache-Control": "no-store, max-age=0",
        "Pragma": "no-cache",
        "Expires": "0",
    }

    @app.get("/{full_path:path}")
    def spa_fallback(full_path: str) -> FileResponse:
        """SPA history fallback：非 /api 路径回 index.html，让 React Router 的客户端路由
        （/history/:id、/progress 等）刷新不 404；dist 下的真实文件（favicon 等）直接服务。"""
        if full_path == "api" or full_path.startswith("api/"):
            # /api/* 未命中业务路由 → 维持统一 JSON 404，不被 SPA 兜底吞掉
            raise HTTPException(status_code=404, detail="Not Found")
        candidate = _DIST_DIR / full_path
        if full_path and candidate.is_file():
            if candidate == _INDEX_HTML:
                return FileResponse(candidate, headers=_INDEX_HEADERS)
            return FileResponse(candidate)
        return FileResponse(_INDEX_HTML, headers=_INDEX_HEADERS)
