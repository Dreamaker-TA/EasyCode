"""执行接地测试用例的 Pydantic schema。

两层模型：
- ``TestCase`` / ``TestSuite``：**全量内部模型**，用于 ingest 校验与启动加载。
  ``extra="forbid"`` + 必填字段 + ``Literal`` checker + ``min_length`` 让缺字段 / 多字段
  / 坏 checker / 空 cases 全部在校验期 fail-fast。
- ``PublicTestCase`` / ``ProblemTestsResponse``：**对外响应视图**。

关键不变量（镜像 reference_solution_md 的防泄处理）：对外响应只暴露 ``is_sample``
用例的 ``stdin`` / ``expected_stdout``；非样例用例内容不外泄。``source_path`` 同样
绝不进任何对外 schema。
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

# token(默认,空白归一化) | exact | float | custom。
# 目前只保证 token 语义；其余值校验通过但暂无语义。
CheckerType = Literal["token", "exact", "float", "custom"]


class TestCase(BaseModel):
    """单个测试用例（全量内部模型）。"""

    model_config = ConfigDict(extra="forbid")

    id: str
    is_sample: bool = False
    stdin: str
    expected_stdout: str
    note: str = ""


class TestSuite(BaseModel):
    """一道题的测试套件（全量内部模型，对应一个 .tests.json 文件）。"""

    model_config = ConfigDict(extra="forbid")

    version: int = 1
    time_limit_ms: int = Field(default=3000, gt=0)
    memory_limit_mb: int = Field(default=256, gt=0)
    checker: CheckerType = "token"
    cases: list[TestCase] = Field(min_length=1)
    # LeetCode 模式的「可见外壳」起始模板，按语言存（key=language，value=完整代码）。
    # 预写 stdin→print 的 I/O 处理 + 函数 stub，用户只填函数体；执行仍按 ACM（exec 整段）。
    # ACM 模式不需要（编辑器留空）。非机密，随 /tests 全量下发。缺省 {} = 该题无 LeetCode 壳。
    templates: dict[str, str] = Field(default_factory=dict)


# === 对外响应视图（防泄过滤后）===


class PublicTestCase(BaseModel):
    """对外用例视图：仅 is_sample 用例携带 stdin/expected_stdout/note。"""

    id: str
    is_sample: bool
    stdin: str | None = None
    expected_stdout: str | None = None
    note: str | None = None


class ProblemTestsResponse(BaseModel):
    """GET /api/problems/{id}/tests 响应。无边车时 has_tests=false、其余字段空。"""

    problem_id: int
    has_tests: bool
    checker: CheckerType | None = None
    time_limit_ms: int | None = None
    cases: list[PublicTestCase] = Field(default_factory=list)
    # LeetCode 模式起始模板（按语言）。无边车 / 未授权该题 → {}，前端回退到 ACM 空编辑器。
    templates: dict[str, str] = Field(default_factory=dict)
