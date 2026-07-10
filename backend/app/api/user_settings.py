"""User-editable settings API."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException

from app.schemas.problem import ErrorDetail, ErrorResponse
from app.schemas.user_settings import LLMSettingsPatch, LLMSettingsPublic
from app.services import user_settings_service

router = APIRouter(prefix="/settings", tags=["settings"])


def _err(code: str, msg: str, status_code: int) -> HTTPException:
    return HTTPException(
        status_code=status_code,
        detail=ErrorResponse(error=ErrorDetail(code=code, message=msg)).model_dump(),
    )


@router.get("/llm", response_model=LLMSettingsPublic)
def get_llm_settings() -> LLMSettingsPublic:
    return LLMSettingsPublic(**user_settings_service.get_llm_settings())


@router.patch("/llm", response_model=LLMSettingsPublic)
def patch_llm_settings(payload: LLMSettingsPatch) -> LLMSettingsPublic:
    try:
        updated = user_settings_service.update_llm_settings(payload)
    except OSError as exc:
        raise _err("SETTINGS_WRITE_FAILED", f"settings could not be saved: {exc}", 500)
    except ValueError as exc:
        raise _err("SETTINGS_INVALID_VALUE", str(exc), 422)
    return LLMSettingsPublic(**updated)
