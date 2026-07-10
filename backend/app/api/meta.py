"""运行时元信息端点。

响应只含前端需感知的运行时配置，**不含任何密钥**。
"""

from __future__ import annotations

from fastapi import APIRouter

from app.settings import settings

router = APIRouter(prefix="/meta", tags=["meta"])


@router.get("")
def get_meta() -> dict:
    return {
        "executor": settings.EXECUTOR,
        "version": "0.0.1",
    }
