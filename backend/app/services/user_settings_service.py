"""Persist and apply user-editable local settings."""

from __future__ import annotations

import os
import shlex
from pathlib import Path
from urllib.parse import urlsplit

from app.schemas.user_settings import LLMSettingsPatch
from app.settings import PROJECT_ROOT, settings
from app.services.llm_client import set_client

ENV_PATH = Path(os.environ.get("EASYCODE_SETTINGS_PATH") or PROJECT_ROOT / ".env")


def get_llm_settings() -> dict:
    return {
        "llm_base_url": settings.LLM_BASE_URL,
        "llm_model": settings.LLM_MODEL,
        "llm_provider": _infer_provider(settings.LLM_BASE_URL),
        "llm_key_configured": bool(settings.LLM_API_KEY.strip()),
        "structured_output_mode": settings.LLM_STRUCTURED_OUTPUT,
    }


def update_llm_settings(payload: LLMSettingsPatch) -> dict:
    updates = {
        "LLM_BASE_URL": payload.llm_base_url,
        "LLM_MODEL": payload.llm_model,
        "LLM_STRUCTURED_OUTPUT": payload.structured_output_mode,
    }
    if payload.clear_llm_api_key:
        updates["LLM_API_KEY"] = ""
    elif payload.llm_api_key:
        updates["LLM_API_KEY"] = payload.llm_api_key

    _write_env(ENV_PATH, updates)
    _apply_runtime(updates)
    return get_llm_settings()


def _write_env(path: Path, updates: dict[str, str]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    lines = path.read_text(encoding="utf-8").splitlines() if path.exists() else []
    remaining = dict(updates)
    out: list[str] = []

    for line in lines:
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or "=" not in line:
            out.append(line)
            continue
        key = line.split("=", 1)[0].strip()
        if key in remaining:
            out.append(f"{key}={_escape_env_value(remaining.pop(key))}")
        else:
            out.append(line)

    if remaining:
        if out and out[-1].strip():
            out.append("")
        out.append("# === Settings page ===")
        for key, value in remaining.items():
            out.append(f"{key}={_escape_env_value(value)}")

    path.write_text("\n".join(out).rstrip() + "\n", encoding="utf-8")


def _apply_runtime(updates: dict[str, str]) -> None:
    for key, value in updates.items():
        setattr(settings, key, value)
    set_client(None)


def _escape_env_value(value: str) -> str:
    if "\n" in value or "\r" in value:
        raise ValueError("env value must be a single line")
    return shlex.quote(value)


def _infer_provider(base_url: str) -> str:
    host = (urlsplit(base_url).hostname or "").lower()
    if "deepseek" in host:
        return "DeepSeek"
    if "dashscope" in host or "aliyun" in host:
        return "Qwen"
    if "openrouter" in host:
        return "OpenRouter"
    if host in {"localhost", "127.0.0.1", "0.0.0.0", "::1"}:
        return "Ollama / local"
    return urlsplit(base_url).netloc or "Custom endpoint"
