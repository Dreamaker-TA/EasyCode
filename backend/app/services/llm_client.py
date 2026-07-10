"""OpenAI 风格 LLM 客户端 + 抽象。

设计决策：用同步 `OpenAI` 客户端（非 AsyncOpenAI）。
原因：评测由 finalize 丢给 `BackgroundTasks` 在线程池里**同步**跑，个人本地
+ 并发=1 不需要 async；async 会让 sync 函数被迫 asyncio.run 反而更难维护。
"""

from __future__ import annotations

import json
import logging
from collections.abc import Iterator
from typing import Any, Protocol
from urllib.parse import urlsplit

import httpx
from openai import OpenAI

from app.settings import settings

log = logging.getLogger(__name__)

# 结构化输出降级链：强 → 弱。
_STRUCTURED_MODE_CHAIN = ("json_schema", "json_object", "text")
# 端点能力错误识别关键词（；对错误体做大小写不敏感子串匹配）。
_CAPABILITY_ERROR_KEYWORDS = (
    "response_format",
    "json_schema",
    "not supported",
    "unsupported",
    "unknown parameter",
)


class LLMUnavailable(Exception):
    """网络 / 鉴权 / 服务不可达。路由层映射为 503。"""


class LLMNotConfigured(LLMUnavailable):
    """真实 LLM 模式缺少必要配置。路由层映射为 503 + LLM_NOT_CONFIGURED。"""


class LLMOutputInvalid(Exception):
    """LLM 返回了但 JSON 不合 schema。路由层映射为 502。"""


class LLMClient(Protocol):
    def chat_json(
        self,
        *,
        system: str,
        user: str,
        temperature: float = 0.2,
        max_tokens: int = 2000,
        schema: dict | None = None,
    ) -> dict[str, Any]: ...

    def chat_text(
        self,
        *,
        system: str,
        user: str,
        temperature: float = 0.4,
        max_tokens: int = 800,
    ) -> str: ...

    def chat_text_stream(
        self,
        *,
        system: str,
        user: str,
        temperature: float = 0.4,
        max_tokens: int = 800,
    ) -> Iterator[str]: ...


class OpenAIStyleClient:
    """指向 OpenAI 风格 endpoint（DeepSeek / Qwen / Ollama）。"""

    def __init__(
        self,
        base_url: str,
        api_key: str,
        model: str,
        timeout: float = 60.0,
        structured_output: str | None = None,
    ) -> None:
        self.model = model
        self._client = OpenAI(
            base_url=base_url,
            api_key=api_key or "no-key",  # Ollama 等本地服务不要求真 key
            timeout=httpx.Timeout(timeout),
            # SDK 级 HTTP 重试：连接错误 / 408 / 409 / 429 / 5xx 自动重试，
            # 抵御一次网络抖动；重试耗尽才抛 → _do_review 走降级。JSON 不合 schema 不在此重试。
            max_retries=2,
        )
        # 结构化输出能力协商：
        # auto → 乐观从最强模式起步，端点能力错误时降一级并同 prompt 立即重试；
        # 显式指定则钉死不探测。降级缓存 = 实例属性（进程单例 = 单端点，）。
        configured = structured_output or settings.LLM_STRUCTURED_OUTPUT
        self._mode_pinned = configured != "auto"
        self._mode: str = "json_schema" if configured == "auto" else configured
        # json_schema 一旦成功建立：后续 400/422 不再触发降级，
        # 且 llm_review 可省略 prompt 内嵌 schema 文本。
        self.json_schema_established = False

    @property
    def structured_output_mode(self) -> str:
        """当前生效的结构化输出模式（探测降级后的实际值，review_meta 记录用）。"""
        return self._mode

    def _effective_mode(self, schema: dict | None) -> str:
        # 无 schema 的调用（如求助 chat_text 之外的松散 JSON）最强只到 json_object。
        if schema is None and self._mode == "json_schema":
            return "json_object"
        return self._mode

    def _should_downgrade(self, exc: Exception, mode: str) -> bool:
        if self._mode_pinned or mode == "text":
            return False
        status = getattr(exc, "status_code", None)
        if status not in (400, 422):
            return False
        if mode == "json_schema":
            # 首次 json_schema 遇任何 400/422 保守降级（宁多降一级也不死循环报错）；
            # 一旦建立不再降——模式确立后的 400 多半另有原因。
            return not self.json_schema_established
        # json_object 是长期存量路径，400 通常另有原因——仅关键词命中才降到 text。
        body = str(exc).lower()
        return any(k in body for k in _CAPABILITY_ERROR_KEYWORDS)

    def _downgrade(self, from_mode: str, exc: Exception) -> None:
        idx = _STRUCTURED_MODE_CHAIN.index(from_mode)
        self._mode = _STRUCTURED_MODE_CHAIN[min(idx + 1, len(_STRUCTURED_MODE_CHAIN) - 1)]
        log.warning(
            "structured output downgraded %s -> %s (endpoint capability error: %s)",
            from_mode,
            self._mode,
            exc,
        )

    def chat_json(
        self,
        *,
        system: str,
        user: str,
        temperature: float = 0.2,
        max_tokens: int = 2000,
        schema: dict | None = None,
    ) -> dict[str, Any]:
        messages = [
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ]
        while True:
            mode = self._effective_mode(schema)
            kwargs: dict[str, Any] = {}
            if mode == "json_schema":
                assert schema is not None  # _effective_mode 保证
                kwargs["response_format"] = {
                    "type": "json_schema",
                    "json_schema": {
                        "name": str(schema.get("title") or "structured_output"),
                        "strict": True,
                        "schema": schema,
                    },
                }
            elif mode == "json_object":
                kwargs["response_format"] = {"type": "json_object"}
            # text：不传 response_format，靠 prompt 约束 + 剥围栏 parse。
            try:
                resp = self._client.chat.completions.create(
                    model=self.model,
                    messages=messages,
                    temperature=temperature,
                    max_tokens=max_tokens,
                    **kwargs,
                )
            except Exception as e:  # noqa: BLE001
                if self._should_downgrade(e, mode):
                    self._downgrade(mode, e)
                    continue  # 同一 prompt 立即重试。
                raise LLMUnavailable(f"{type(e).__name__}: {e}") from e
            if mode == "json_schema":
                self.json_schema_established = True
            break

        text = (resp.choices[0].message.content or "").strip()
        if not text:
            raise LLMOutputInvalid("empty content")
        try:
            return json.loads(text)
        except json.JSONDecodeError as e:
            # 兜底：有的模型会包成 ```json ... ``` 即使开了 json_object / text 模式必经此路
            cleaned = _strip_codefence(text)
            try:
                return json.loads(cleaned)
            except json.JSONDecodeError:
                raise LLMOutputInvalid(f"not valid JSON: {e.msg}") from e

    def chat_text(
        self,
        *,
        system: str,
        user: str,
        temperature: float = 0.4,
        max_tokens: int = 800,
    ) -> str:
        try:
            resp = self._client.chat.completions.create(
                model=self.model,
                messages=[
                    {"role": "system", "content": system},
                    {"role": "user", "content": user},
                ],
                temperature=temperature,
                max_tokens=max_tokens,
            )
        except Exception as e:  # noqa: BLE001
            raise LLMUnavailable(f"{type(e).__name__}: {e}") from e
        return (resp.choices[0].message.content or "").strip()

    def chat_text_stream(
        self,
        *,
        system: str,
        user: str,
        temperature: float = 0.4,
        max_tokens: int = 800,
    ) -> Iterator[str]:
        try:
            stream = self._client.chat.completions.create(
                model=self.model,
                messages=[
                    {"role": "system", "content": system},
                    {"role": "user", "content": user},
                ],
                temperature=temperature,
                max_tokens=max_tokens,
                stream=True,
            )
            for chunk in stream:
                if not chunk.choices:
                    continue
                delta = chunk.choices[0].delta.content or ""
                if delta:
                    yield delta
        except Exception as e:  # noqa: BLE001
            raise LLMUnavailable(f"{type(e).__name__}: {e}") from e


def _strip_codefence(text: str) -> str:
    if text.startswith("```"):
        lines = text.splitlines()
        # 去掉首行 ```xxx 和尾行 ```
        if lines and lines[-1].strip().startswith("```"):
            return "\n".join(lines[1:-1])
        return "\n".join(lines[1:])
    return text


_singleton: LLMClient | None = None


def get_client() -> LLMClient:
    """单例 LLMClient。"""
    global _singleton
    if _singleton is None:
        if _requires_api_key(settings.LLM_BASE_URL) and not settings.LLM_API_KEY.strip():
            raise LLMNotConfigured("LLM_API_KEY is not configured")
        _singleton = OpenAIStyleClient(
            base_url=settings.LLM_BASE_URL,
            api_key=settings.LLM_API_KEY,
            model=settings.LLM_MODEL,
        )
    return _singleton


def _requires_api_key(base_url: str) -> bool:
    host = (urlsplit(base_url).hostname or "").lower()
    return host not in {"localhost", "127.0.0.1", "0.0.0.0", "::1"}


def set_client(client: LLMClient | None) -> None:
    """用于测试或显式替换当前 LLM client。"""
    global _singleton
    _singleton = client
