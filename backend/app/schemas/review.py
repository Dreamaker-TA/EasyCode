"""LLM 评测的输入输出 schema（**全局唯一规范源**）。

任何路由层、前端展示层都引用本文件的类型，不自行另立结构。
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

# 五维雷达的分维度等级（除正确性外的四维由 LLM 直接给等级；正确性仍由本地执行判定接地）。
# 前端按固定网格渲染：excellent=100 / good=80 / fair=60 / weak=40 / poor=20。
# 让模型出**离散等级**而非 0–100 连续分——LLM 对有序档位远比对校准分可靠，也免去从总评级反推的循环。
DimensionLevel = Literal["excellent", "good", "fair", "weak", "poor"]


class ReviewQuality(BaseModel):
    score: int = Field(ge=0, le=10)
    level: DimensionLevel
    comments: str


class ReviewComplexity(BaseModel):
    level: DimensionLevel
    time: str
    space: str
    explain: str


class ReviewOutput(BaseModel):
    # CoT 草稿：评委先在此手算 2-3 用例、核对 rubric、推导复杂度，再据此填其余字段。
    # 放首字段 → model_json_schema() 按定义序输出 → 引导模型先生成它（CoT-in-JSON）。
    # 默认 "" → 降级 stub 与省略该字段的模型仍能 model_validate。
    scratchpad: str = ""
    can_compile: bool
    compile_issues: list[str] = Field(default_factory=list)
    quality: ReviewQuality
    complexity: ReviewComplexity
    optimization: list[str] = Field(default_factory=list)
    process_review: str
    # 过程 / 建议两维的等级（质量、复杂度的等级在各自子对象里）。正确性不在此列——它由执行判定接地。
    process_level: DimensionLevel
    guidance_level: DimensionLevel
    rating: Literal["A", "B", "C", "D"]
    rating_rationale: str


def strict_json_schema(model: type[BaseModel]) -> dict:
    """派生 strict 结构化输出用的 JSON Schema。

    在 ``model_json_schema()`` 的所有 object 节点（含 ``$defs`` 嵌套）注入
    ``additionalProperties: false``——OpenAI 风格端点 strict 模式的必要变换。
    纯函数，独立可测，不发起任何网络调用。
    """
    schema = model.model_json_schema()
    _forbid_additional_properties(schema)
    return schema


def _forbid_additional_properties(node: object) -> None:
    if isinstance(node, dict):
        if node.get("type") == "object" or "properties" in node:
            node.setdefault("additionalProperties", False)
        for value in node.values():
            _forbid_additional_properties(value)
    elif isinstance(node, list):
        for item in node:
            _forbid_additional_properties(item)
