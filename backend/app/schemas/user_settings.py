"""User-editable settings schema.

Responses expose only non-sensitive state. API keys are write-only.
"""

from __future__ import annotations

from typing import Literal
from urllib.parse import urlsplit

from pydantic import BaseModel, Field, field_validator


StructuredOutputMode = Literal["auto", "json_schema", "json_object", "text"]


class LLMSettingsPublic(BaseModel):
    llm_base_url: str
    llm_model: str
    llm_provider: str
    llm_key_configured: bool
    structured_output_mode: StructuredOutputMode


class LLMSettingsPatch(BaseModel):
    llm_base_url: str = Field(min_length=1, max_length=500)
    llm_model: str = Field(min_length=1, max_length=200)
    llm_api_key: str | None = Field(default=None, max_length=1000)
    clear_llm_api_key: bool = False
    structured_output_mode: StructuredOutputMode

    @field_validator("llm_base_url", "llm_model", "llm_api_key")
    @classmethod
    def _strip_single_line(cls, value: str | None) -> str | None:
        if value is None:
            return None
        stripped = value.strip()
        if "\n" in stripped or "\r" in stripped:
            raise ValueError("value must be a single line")
        return stripped

    @field_validator("llm_base_url")
    @classmethod
    def _validate_base_url(cls, value: str) -> str:
        parsed = urlsplit(value)
        if parsed.scheme not in {"http", "https"} or not parsed.netloc:
            raise ValueError("llm_base_url must be an absolute http(s) URL")
        return value.rstrip("/")
