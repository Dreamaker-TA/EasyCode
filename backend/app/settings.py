"""集中读取本地配置。

默认从工程根的 ``.env`` 加载；容器中可通过
``EASYCODE_SETTINGS_PATH`` 指定设置页保存的持久化配置文件。
"""

import os
from pathlib import Path
from typing import Literal

from pydantic_settings import (
    BaseSettings,
    DotEnvSettingsSource,
    PydanticBaseSettingsSource,
    SettingsConfigDict,
)

PROJECT_ROOT = Path(__file__).resolve().parents[2]

DEFAULT_DEV_CORS_ORIGINS = (
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:5174",
    "http://127.0.0.1:5174",
    "http://localhost:5175",
    "http://127.0.0.1:5175",
)


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=PROJECT_ROOT / ".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    LLM_BASE_URL: str = "https://api.deepseek.com"
    LLM_API_KEY: str = ""
    LLM_MODEL: str = "deepseek-v4-flash"

    DB_PATH: str = "backend/data/easycode.db"

    # Problem material is data, not application code. Source checkouts may use
    # a local ignored ./Code directory; clean checkouts and Docker fall back to
    # the tiny tracked example bank.
    EASYCODE_PROBLEM_BANK_ROOT: str = ""
    EASYCODE_PROBLEMS_JSON_PATH: str = ""

    # 执行接地后端开关。后端权威：
    #   pyodide(默认) — 前端用 Pyodide 做即时反馈；finalize 时后端按同一测试套件复跑并
    #                   以服务端结果作为 review/SRS ground truth。/tests?include_hidden=1
    #                   仍用于本地前端全量预跑，破防泄边界，仅本地单用户可接受。
    #   none          — 不接收执行接地，纯 LLM 文本评测降级；/tests 永远屏蔽非样例 I/O。
    # isolate/piston 等服务端执行器可在自托管部署中按需扩展。
    # 前端运行时读取 /api/meta，不再使用单独的构建期执行器配置。
    EXECUTOR: Literal["pyodide", "none"] = "pyodide"

    # 结构化输出模式。
    #   auto        — 试探式协商：从 json_schema(strict) 起步，端点能力错误（400/422）自动
    #                 降级 json_object → text，并用同一 prompt 立即重试；降级结果进程内缓存。
    #   json_schema / json_object / text — 显式钉死该模式（诊断 / 规避端点怪癖用）。
    # 无论哪级，服务端 Pydantic 事后校验永不跳过（防御纵深）。
    LLM_STRUCTURED_OUTPUT: Literal["auto", "json_schema", "json_object", "text"] = "auto"

    # development 会自动追加 Vite 常见端口，production 只使用显式 CORS_ORIGINS。
    APP_ENV: Literal["development", "production"] = "development"

    CORS_ORIGINS: str = ",".join(DEFAULT_DEV_CORS_ORIGINS)

    @classmethod
    def settings_customise_sources(
        cls,
        settings_cls: type[BaseSettings],
        init_settings: PydanticBaseSettingsSource,
        env_settings: PydanticBaseSettingsSource,
        dotenv_settings: PydanticBaseSettingsSource,
        file_secret_settings: PydanticBaseSettingsSource,
    ) -> tuple[PydanticBaseSettingsSource, ...]:
        """让设置页保存的本地配置在重启后仍能生效。

        Docker 会把启动时的环境变量传入容器；设置页则把用户后来选择的
        模型服务写到 ``EASYCODE_SETTINGS_PATH``。把这个文件放在环境变量之前，
        才不会在容器重启后被启动时的默认值覆盖。
        """
        settings_path = Path(
            os.environ.get("EASYCODE_SETTINGS_PATH") or PROJECT_ROOT / ".env"
        )
        saved_settings = DotEnvSettingsSource(
            settings_cls,
            env_file=settings_path,
            env_file_encoding="utf-8",
        )
        return init_settings, saved_settings, env_settings, dotenv_settings, file_secret_settings

    @property
    def cors_origins_list(self) -> list[str]:
        origins = [o.strip() for o in self.CORS_ORIGINS.split(",") if o.strip()]
        if self.APP_ENV == "production":
            return origins
        for origin in DEFAULT_DEV_CORS_ORIGINS:
            if origin not in origins:
                origins.append(origin)
        return origins

    @property
    def problem_bank_root_path(self) -> Path:
        if self.EASYCODE_PROBLEM_BANK_ROOT.strip():
            return _resolve_path(self.EASYCODE_PROBLEM_BANK_ROOT)
        local_bank = PROJECT_ROOT
        if (local_bank / "Code").is_dir():
            return local_bank
        return PROJECT_ROOT / "examples/problem-bank"

    @property
    def code_root_path(self) -> Path:
        return self.problem_bank_root_path / "Code"

    @property
    def problems_json_path(self) -> Path:
        if self.EASYCODE_PROBLEMS_JSON_PATH.strip():
            return _resolve_path(self.EASYCODE_PROBLEMS_JSON_PATH)
        return PROJECT_ROOT / "backend/data/problems.json"


def _resolve_path(value: str) -> Path:
    path = Path(value).expanduser()
    if path.is_absolute():
        return path
    return PROJECT_ROOT / path


settings = Settings()
