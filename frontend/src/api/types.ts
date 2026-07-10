/**
 * 后端 schema 的 TypeScript 翻译。
 *
 * 任何字段变更：先改后端 Pydantic schema，再回头改这里。
 */

export type Rating = "A" | "B" | "C" | "D";
export type SubmissionMode = "untimed" | "timed";
// JavaScript 已整体下线（无本地执行接地、覆盖率过低、体验割裂），现仅支持 Python。
export type Language = "python";
// 异步评测：finalize 后先进 reviewing，
// 后台评测完成 → submitted，降级 → review_failed。reviewed_at 非空即评测终态。
export type SubmissionStatus = "draft" | "reviewing" | "submitted" | "review_failed";

export interface MasteryInfo {
  effective_rating: Rating | null;
  user_rating: Rating | null;
  auto_rating: Rating | null;
}

export interface ProblemListItem {
  id: number;
  leetcode_id: number | null;
  external_id: string | null;
  title: string;
  category: string;
  chapter_no: number;
  problem_no: number;
  is_core: boolean;
  mastery: MasteryInfo | null;
}

export interface ProblemListResponse {
  items: ProblemListItem[];
  total: number;
}

export interface ProblemDetail extends Omit<ProblemListItem, "mastery"> {
  statement_md: string;
  /** 该题可写/可评的语言集；当前公开能力仅 Python。 */
  supported_languages: Language[];
  mastery: MasteryInfo | null;
  last_submission_id: string | null;
}

// === 提交相关 ===

export interface SubmissionDraft {
  id: string;
  problem_id: number;
  status: SubmissionStatus;
  mode: SubmissionMode;
  mode_limit_sec: number | null;
  language: Language;
  created_at: string;
}

/** 五维雷达分维度等级（正确性除外，其由本地执行判定接地）。缺少此字段时前端回退到启发式公式。 */
export type ReviewDimensionLevel = "excellent" | "good" | "fair" | "weak" | "poor";

export interface ReviewOutput {
  can_compile: boolean;
  rating: Rating | null;
  rating_rationale: string;
  quality: { score: number; comments: string; level?: ReviewDimensionLevel };
  complexity: { time: string; space: string; explain: string; level?: ReviewDimensionLevel };
  optimization: string[];
  compile_issues: string[];
  process_review: string;
  process_level?: ReviewDimensionLevel;
  guidance_level?: ReviewDimensionLevel;
  scratchpad?: string | null;
  /** 仅 LLM 不可用降级时存在 */
  error?: string | null;
  /** 降级 / 失败的机器可读错误码，用于前端恢复路径。 */
  error_code?: string | null;
}

export interface ReviewScheduleSummary {
  next_review_at: string;
  interval_days: number;
  generated_from_rating: Rating;
  prior_interval_days: number | null;
}

export interface SubmissionDetail {
  id: string;
  problem_id: number;
  status: SubmissionStatus;
  code: string;
  elapsed_sec: number;
  mode: SubmissionMode;
  mode_limit_sec: number | null;
  language: Language;
  created_at: string;
  submitted_at: string | null;
  reviewed_at: string | null;
  review_started_at: string | null;
  review_attempts: number;
  review_last_error_code: string | null;
  review: ReviewOutput | null;
  review_schedule: ReviewScheduleSummary | null;
  user_rating_override: Rating | null;
  snapshots_count: number;
}

export interface SubmissionContinueResponse {
  submission: SubmissionDraft;
  /** 新会话快照应从 t_offset_resume + 30 起算,避开复制过来的旧帧与 marker。 */
  t_offset_resume: number;
}

export interface SnapshotIn {
  t_offset_sec: number;
  code: string;
  code_hash: string;
  client_ts: string;
}

export interface SnapshotBatchResult {
  accepted: number;
  duplicates: number;
}

// === 历史 / 快照公开视图 ===

export interface SubmissionListItem {
  id: string;
  status: SubmissionStatus;
  submitted_at: string | null;
  elapsed_sec: number;
  mode: SubmissionMode;
  language: Language;
  review_rating: Rating | null;
  user_rating_override: Rating | null;
  effective_rating?: Rating | null;
  snapshots_count: number;
}

export interface SubmissionListResponse {
  items: SubmissionListItem[];
  total: number;
}

// === 跨题目历史聚合(顶部「历史」tab) ===

export interface HistoryListItem {
  problem_id: number;
  title: string;
  category: string;
  chapter_no: number;
  problem_no: number;
  is_core: boolean;
  submissions_count: number;
  latest_submitted_at: string;
  latest_rating: Rating | null;
  latest_summary: string | null;
}

export interface HistoryListResponse {
  items: HistoryListItem[];
  total: number;
}

export interface SnapshotPublic {
  t_offset_sec: number;
  code: string;
  code_hash: string;
  /** "code" = 普通编辑帧；"submit_marker" = 续编时注入的"上次提交"标注帧。 */
  kind: "code" | "submit_marker";
  /** 仅 submit_marker 帧非空：上次提交的评级（= 父提交 review_rating）。 */
  rating: Rating | null;
}

export interface SnapshotListResponse {
  submission_id: string;
  items: SnapshotPublic[];
}

// === SRS ===

export interface MasteryAfterUpdate {
  problem_id: number;
  auto_rating: Rating | null;
  user_rating: Rating | null;
  effective_rating: Rating | null;
  next_review_at: string | null;
  interval_days: number | null;
}

export interface DueItem {
  problem_id: number;
  leetcode_id: number | null;
  external_id: string | null;
  title: string;
  category: string;
  effective_rating: Rating | null;
  due_at: string;
  days_overdue: number;
  priority: "must" | "recommended" | "optional";
  reason_codes: string[];
  interval_days: number | null;
  last_reviewed_at: string | null;
}

export interface DueResponse {
  today: string;
  items: DueItem[];
}

// === 成长趋势（GET /api/stats/growth） ===

export interface DailySubmissionCount {
  date: string;
  submissions: number;
}

export interface WeakCategory {
  category: string;
  low_rating_count: number;
  submissions: number;
}

export interface RetriedProblem {
  problem_id: number;
  title: string;
  submissions_count: number;
}

export interface GrowthStats {
  window_days: number;
  submissions: number;
  rating_counts: Record<Rating, number>;
  review_due_count: number;
  daily_submissions: DailySubmissionCount[];
  weak_categories: WeakCategory[];
  most_retried_problems: RetriedProblem[];
}

// === 训练首页概览（GET /api/training/overview） ===

export interface RecommendedProblem {
  id: number;
  title: string;
  leetcode_id: number | null;
  external_id: string | null;
  category: string;
  chapter_no: number;
  problem_no: number;
  is_core: boolean;
  reason: string;
}

export interface RecentTraining {
  submissions_7d: number;
  latest_rating: Rating | null;
  weak_category: string | null;
}

export type SchedulerState =
  | "hard_recovery"
  | "review_recovery"
  | "due_review"
  | "post_review"
  | "recommended_next"
  | "healthy";

export interface PrimaryTarget {
  href: string;
  label: string;
  entity_id: string | null;
}

export interface SecondaryFact {
  label: string;
  value: string;
  tone: "neutral" | "ok" | "warn" | "danger";
}

export interface TrainingOverview {
  today: string;
  due_count: number;
  stale_review_count: number;
  review_failed_count: number;
  recommended_problem: RecommendedProblem | null;
  recent: RecentTraining;
  has_history: boolean;
  audience_state:
    | "llm_first_run"
    | "llm_continue"
    | "llm_returning_due"
    | "empty_problem_bank";
  scheduler_state: SchedulerState;
  state_rank: number;
  state_reason: string;
  primary_action:
    | "settings"
    | "retry_review"
    | "review_due"
    | "review_result"
    | "recommended"
    | "browse";
  primary_target: PrimaryTarget;
  secondary_facts: SecondaryFact[];
}

// === 删除（单条 / 批量） ===

export interface BatchDeleteResult {
  deleted: number;
  not_found: string[];
}

// === 对话式助教 ===

export type TutorRole = "student" | "tutor";

export interface TutorMessage {
  id: number;
  submission_id: string;
  role: TutorRole;
  content: string;
  tier_at: number;
  created_at: string;
}

export interface TutorMessageListResponse {
  messages: TutorMessage[];
}

export interface TutorMessagePostResponse {
  message: TutorMessage;
  tier_before: number;
  tier_after: number;
}

// === 错误结构（main.py 的统一格式） ===

export interface BackendError {
  error: { code: string; message: string; details?: Record<string, unknown> };
}

// === 运行时元信息（GET /api/meta） ===

export interface Meta {
  executor: "pyodide" | "none";
  version: string;
}

// === 设置诊断（GET /api/diagnostics） ===

export type DiagnosticStatus = "ok" | "warn" | "error";

export interface DiagnosticCheck {
  label: string;
  status: DiagnosticStatus;
  message: string;
  recovery: string | null;
}

export interface RuntimeDiagnostics {
  version: string;
  backend_ok: boolean;
  database_ok: boolean;
  database_path: string;
  database_size_bytes: number | null;
  cors_origins: string[];
  api_base_hint: string;
  checks: DiagnosticCheck[];
}

export interface ReviewDiagnostics {
  mode: "llm";
  llm_key_configured: boolean;
  llm_base_url: string;
  llm_model: string;
  llm_provider: string;
  pending_review_count: number;
  stale_review_count: number;
  review_stale_after_sec: number;
  oldest_review_started_at: string | null;
  checks: DiagnosticCheck[];
}

export interface ExecutionDiagnostics {
  executor: "pyodide" | "none";
  pyodide_assets_present: boolean;
  testcase_problem_count: number;
  checks: DiagnosticCheck[];
}

export interface ImportErrorSummary {
  source: string;
  message: string;
}

export interface ProblemsDiagnostics {
  source_path: string;
  source_files: number;
  parsed_count: number;
  seeded_count: number;
  rubric_problem_count: number;
  last_generated_at: string | null;
  last_seeded_at: string | null;
  errors: ImportErrorSummary[];
  checks: DiagnosticCheck[];
}

export interface DiagnosticsResponse {
  generated_at: string;
  runtime: RuntimeDiagnostics;
  review: ReviewDiagnostics;
  execution: ExecutionDiagnostics;
  problems: ProblemsDiagnostics;
}

// === 用户可编辑设置（GET/PATCH /api/settings/llm） ===

export type StructuredOutputMode = "auto" | "json_schema" | "json_object" | "text";

export interface LLMSettings {
  llm_base_url: string;
  llm_model: string;
  llm_provider: string;
  llm_key_configured: boolean;
  structured_output_mode: StructuredOutputMode;
}

export interface LLMSettingsPatch {
  llm_base_url: string;
  llm_model: string;
  llm_api_key?: string | null;
  clear_llm_api_key?: boolean;
  structured_output_mode: StructuredOutputMode;
}

// === 执行接地：测试用例 + 运行结果 ===

// 与后端 schemas/testcase.py::CheckerType 对齐。
export type CheckerType = "token" | "exact" | "float" | "custom";

/**
 * GET /problems/{id}/tests 的单个用例视图（镜像后端 PublicTestCase）。
 * 防泄：非样例用例 stdin/expected_stdout/note 一律为 null。
 */
export interface PublicTestCase {
  id: string;
  is_sample: boolean;
  stdin: string | null;
  expected_stdout: string | null;
  note: string | null;
}

/** GET /problems/{id}/tests 响应。无边车时 has_tests=false，其余字段空。 */
export interface ProblemTests {
  problem_id: number;
  has_tests: boolean;
  checker: CheckerType | null;
  time_limit_ms: number | null;
  cases: PublicTestCase[];
  /** LeetCode 模式起始模板（按语言）。无授权模板时为 {}，前端回退 ACM 空编辑器。 */
  templates: Record<string, string>;
}

// 执行结果结构。useRunCode 返回、TestOutputPanel 渲染；提交时可随请求发送，
// 但后端会复跑并用服务端结果作为 run-then-review 的权威证据。
export type RunVerdict = "OK" | "WRONG" | "RUNTIME_ERROR" | "COMPILE_ERROR" | "TLE";
export type CaseStatus = "WRONG" | "RUNTIME_ERROR" | "TLE";

export interface RunFailure {
  id: string;
  /** 恒 true（只跑样例）；跑非样例时为 false 且下三项置 null（UI 防泄）。 */
  is_sample: boolean;
  status: CaseStatus;
  stdin: string | null;
  expected: string | null;
  actual: string | null;
  /** RUNTIME_ERROR 携带 traceback；其余 null。 */
  stderr: string | null;
}

export interface RunResult {
  verdict: RunVerdict;
  /** 通过的用例数。 */
  passed: number;
  /** 跑过的用例数。 */
  total: number;
  failures: RunFailure[];
  /** COMPILE_ERROR 时携带语法错信息。 */
  error?: string;
}
