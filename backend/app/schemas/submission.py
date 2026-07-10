"""提交 / 快照接口的 Pydantic schema。"""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

CODE_MAX_CHARS = 200_000
SNAPSHOT_BATCH_MAX = 120
RUN_OUTPUT_MAX_CHARS = 20_000


# === 创建提交 ===

class SubmissionCreate(BaseModel):
    problem_id: int
    mode: Literal["untimed", "timed"] = "untimed"
    mode_limit_sec: int | None = None
    # 本次提交语言：默认 python。服务层据题目 supported_languages 校验：
    # 只有"有对应语言参考解"的题才接受该语言），防前端绕过。
    language: str = "python"

    @model_validator(mode="after")
    def _check_mode_consistency(self) -> "SubmissionCreate":
        if self.mode == "timed":
            if self.mode_limit_sec is None or self.mode_limit_sec <= 0:
                raise ValueError("mode='timed' requires positive mode_limit_sec")
        else:
            if self.mode_limit_sec is not None:
                raise ValueError("mode_limit_sec only allowed when mode='timed'")
        return self


class SubmissionDraft(BaseModel):
    """POST /submissions 的响应。"""

    model_config = ConfigDict(from_attributes=True)

    id: str
    problem_id: int
    status: Literal["draft", "reviewing", "submitted", "review_failed"]
    mode: Literal["untimed", "timed"]
    mode_limit_sec: int | None
    language: str
    created_at: datetime


# === 快照 ===

class SnapshotIn(BaseModel):
    t_offset_sec: int = Field(ge=0)
    code: str = Field(max_length=CODE_MAX_CHARS)
    code_hash: str = Field(min_length=12, max_length=12)
    client_ts: datetime

    @field_validator("t_offset_sec")
    @classmethod
    def _multiple_of_30(cls, v: int) -> int:
        if v % 30 != 0:
            raise ValueError("t_offset_sec must be a multiple of 30")
        return v


class SnapshotBatchIn(BaseModel):
    snapshots: list[SnapshotIn] = Field(min_length=1, max_length=SNAPSHOT_BATCH_MAX)


class SnapshotBatchResult(BaseModel):
    accepted: int
    duplicates: int


# === 执行结果（run-then-review，镜像 RunResult/RunFailure） ===

class TestResultFailure(BaseModel):
    """单个失败用例。非样例时 I/O 与 traceback 由前端置 null（防泄）。"""

    id: str
    is_sample: bool
    status: Literal["WRONG", "RUNTIME_ERROR", "TLE"]
    stdin: str | None = Field(default=None, max_length=RUN_OUTPUT_MAX_CHARS)
    expected: str | None = Field(default=None, max_length=RUN_OUTPUT_MAX_CHARS)
    actual: str | None = Field(default=None, max_length=RUN_OUTPUT_MAX_CHARS)
    stderr: str | None = Field(default=None, max_length=RUN_OUTPUT_MAX_CHARS)  # RUNTIME_ERROR 携带 traceback；其余 null


class TestResults(BaseModel):
    """前端 Pyodide 预跑结果（finalize 可随提交带上；后端会复跑并以服务端结果为准）。"""

    verdict: Literal["OK", "WRONG", "RUNTIME_ERROR", "COMPILE_ERROR", "TLE"]
    passed: int = Field(ge=0)
    total: int = Field(ge=0)
    failures: list[TestResultFailure] = Field(default_factory=list)
    error: str | None = Field(default=None, max_length=RUN_OUTPUT_MAX_CHARS)  # COMPILE_ERROR 时携带语法错信息


# === finalize ===

class SubmissionFinalize(BaseModel):
    code: str = Field(max_length=CODE_MAX_CHARS)
    elapsed_sec: int = Field(ge=0)
    # 执行结果：浏览器预跑结果；后端 finalize 会复跑同一套用例并覆盖为权威证据。
    test_results: TestResults | None = None


# === 详情 ===


class ReviewPublic(BaseModel):
    """评测结果对前端的视图。"""

    can_compile: bool
    # 正常评测必有 A/B/C/D；降级失败时无评级 → None（不进 SRS）。
    rating: Literal["A", "B", "C", "D"] | None = None
    rating_rationale: str
    quality: dict
    complexity: dict
    optimization: list[str]
    compile_issues: list[str]
    process_review: str
    # 五维雷达分维度等级（正确性除外，其由执行判定接地）。质量 / 复杂度的等级在各自 dict 里；
    # 过程 / 建议是顶层字段。缺少此字段时 → None，前端回退到启发式公式。
    process_level: Literal["excellent", "good", "fair", "weak", "poor"] | None = None
    guidance_level: Literal["excellent", "good", "fair", "weak", "poor"] | None = None
    # 评委 CoT 演算：持久化进 review_json，前端当前不渲染。
    scratchpad: str | None = None
    # 仅在 LLM 不可用降级时存在；前端据此显示"重试评测"按钮
    error: str | None = None
    # 降级 / 中断的机器可读错误码，用于前端选择恢复路径。
    error_code: str | None = None


class ReviewSchedulePublic(BaseModel):
    """本次评测写入的最新 SRS 安排；仅当排程来源就是当前 submission 时返回。"""

    next_review_at: datetime
    interval_days: int
    generated_from_rating: Literal["A", "B", "C", "D"]
    prior_interval_days: int | None = None


class SubmissionDetail(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    problem_id: int
    status: Literal["draft", "reviewing", "submitted", "review_failed"]
    code: str
    elapsed_sec: int
    mode: Literal["untimed", "timed"]
    mode_limit_sec: int | None
    language: str
    created_at: datetime
    submitted_at: datetime | None
    reviewed_at: datetime | None
    review_started_at: datetime | None
    review_attempts: int
    review_last_error_code: str | None
    review: ReviewPublic | None
    review_schedule: ReviewSchedulePublic | None = None
    user_rating_override: str | None
    snapshots_count: int


# === 续编（C/D 评级 + untimed） ===


class SubmissionContinueResponse(BaseModel):
    """POST /submissions/{id}/continue 的响应。

    - submission: 新建的 draft submission(继承 code / elapsed_sec,parent 指向旧 sub)
    - t_offset_resume: 新会话的快照起跳基线;前端的快照循环应从此值 + 30 开始,
      保证不与从旧 sub 复制过来的快照 t_offset 冲突。
    """

    submission: SubmissionDraft
    t_offset_resume: int


# === 历史列表 ===

class SubmissionListItem(BaseModel):
    """题目历史里的"一行"，不带 code 与 review 详情。"""

    id: str
    status: Literal["draft", "reviewing", "submitted", "review_failed"]
    submitted_at: datetime | None
    elapsed_sec: int
    mode: Literal["untimed", "timed"]
    language: str
    review_rating: Literal["A", "B", "C", "D"] | None
    user_rating_override: Literal["A", "B", "C", "D"] | None
    snapshots_count: int


class SubmissionListResponse(BaseModel):
    items: list[SubmissionListItem]
    total: int


# === 快照公开视图 ===

class SnapshotPublic(BaseModel):
    t_offset_sec: int
    code: str
    code_hash: str
    # kind 区分普通帧与续编注入的 submit_marker 帧；rating 仅 marker 帧填，
    # = 父提交 review_rating（供回放标注"上次提交评级"）。默认值用于已有记录。
    kind: str = "code"
    rating: str | None = None


class SnapshotListResponse(BaseModel):
    submission_id: str
    items: list[SnapshotPublic]


# === 删除（单条 / 批量） ===

class BatchDeleteIn(BaseModel):
    submission_ids: list[str] = Field(min_length=1, max_length=100)


class BatchDeleteResult(BaseModel):
    deleted: int
    not_found: list[str]
