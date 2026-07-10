import type { Language, Rating, RunResult, RunVerdict, SubmissionMode } from "@/api/types";
import type { RunPhase } from "@/hooks/useRunCode";

export type SessionStage =
  | "preparing"
  | "coding"
  | "testing"
  | "submitting"
  | "reviewing"
  | "reviewed"
  | "recoverable_error";

export type TimelineStageId =
  | "prepare"
  | "code"
  | "test"
  | "submit"
  | "review"
  | "recap";

export type TimelineStageStatus = "done" | "current" | "upcoming";

export interface TimelineStage {
  id: TimelineStageId;
  label: string;
  status: TimelineStageStatus;
  summary: string;
  evidence: string;
  actionHint: string;
  tone?: "default" | "warning" | "success";
}

export interface TimelineDraftView {
  mode: SubmissionMode;
  modeLimitSec: number | null;
  language: Language;
}

export interface TimelineSnapshotView {
  accepted: number;
  pending: number;
  lastError: string | null;
}

export interface TimelineTestView {
  phase: RunPhase;
  result: RunResult | null;
  errorMessage: string | null;
  showRunTest: boolean;
  canRunTest: boolean;
  runTestNote?: string | null;
}

export interface TimelineReviewView {
  reviewingElapsedSec: number;
  rating: Rating | null;
  errorMessage: string | null;
  attempts?: number | null;
}

interface BuildTimelineInput {
  stage: SessionStage;
  draft: TimelineDraftView | null;
  elapsedSec: number;
  snapshots: TimelineSnapshotView;
  test: TimelineTestView;
  review: TimelineReviewView;
  canContinue: boolean;
}

export const STAGE_META: Record<SessionStage, { title: string; description: string; step: number }> = {
  preparing: {
    title: "准备本局",
    description: "选择模式后再开始记录，用时、思考节点、测试结果和最终评测会归到同一次训练。",
    step: 0,
  },
  coding: {
    title: "作答中",
    description: "专注写代码。系统会按节奏记录思考节点，提交前可以先跑样例测试。",
    step: 1,
  },
  testing: {
    title: "本地测试",
    description: "样例测试只验证当前代码，不等于提交评测；通过后仍需要提交进入复盘。",
    step: 2,
  },
  submitting: {
    title: "提交评测",
    description: "正在冻结本次代码和过程记录，随后进入后台评测。",
    step: 3,
  },
  reviewing: {
    title: "后台评测",
    description: "评测会结合代码、测试结果和过程记录生成评级与复盘。",
    step: 4,
  },
  reviewed: {
    title: "复盘与复习安排",
    description: "本局已完成。评级会进入复习节奏，复盘用于决定是否继续优化。",
    step: 5,
  },
  recoverable_error: {
    title: "评测可重试",
    description: "代码和训练记录已保留；修复配置或稍后重试即可继续本局评测。",
    step: 4,
  },
};

const STAGE_ORDER: TimelineStageId[] = [
  "prepare",
  "code",
  "test",
  "submit",
  "review",
  "recap",
];

const STAGE_LABELS: Record<TimelineStageId, string> = {
  prepare: "准备",
  code: "作答",
  test: "测试",
  submit: "提交",
  review: "评测",
  recap: "复盘",
};

const ACTIVE_STAGE_ID: Record<SessionStage, TimelineStageId> = {
  preparing: "prepare",
  coding: "code",
  testing: "test",
  submitting: "submit",
  reviewing: "review",
  reviewed: "recap",
  recoverable_error: "review",
};

const VERDICT_LABEL: Record<RunVerdict, string> = {
  OK: "样例通过",
  WRONG: "样例未通过",
  RUNTIME_ERROR: "运行错误",
  COMPILE_ERROR: "语法错误",
  TLE: "执行超时",
};

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const min = Math.floor(seconds / 60);
  const sec = seconds % 60;
  return sec ? `${min}m ${sec}s` : `${min}m`;
}

function formatDraft(draft: TimelineDraftView | null): string {
  if (!draft) return "选择模式";
  const language = "Python";
  if (draft.mode === "untimed") return `${language} · 正计时`;
  const min = draft.modeLimitSec ? Math.floor(draft.modeLimitSec / 60) : null;
  return `${language} · 倒计时${min ? ` ${min} 分钟` : ""}`;
}

function snapshotEvidence(snapshots: TimelineSnapshotView): string {
  const pending = snapshots.pending > 0 ? `，${snapshots.pending} 个待同步` : "";
  if (snapshots.lastError && snapshots.pending > 0) {
    return `已记录 ${snapshots.accepted} 个思考节点，网络恢复后继续同步`;
  }
  return `已记录 ${snapshots.accepted} 个思考节点${pending}`;
}

function testEvidence(test: TimelineTestView): string {
  if (test.phase === "loading_runtime") return "正在准备本地 Python 运行时";
  if (test.phase === "running") return "正在运行样例";
  if (test.phase === "error") return "样例执行没有完成";
  if (test.result) {
    return `${VERDICT_LABEL[test.result.verdict]}，${test.result.passed}/${test.result.total} 通过`;
  }
  if (!test.showRunTest) return "当前题目没有可运行样例";
  if (!test.canRunTest && test.runTestNote) return "当前语言暂无本地样例执行";
  return "尚未运行样例";
}

function stageStatus(id: TimelineStageId, activeId: TimelineStageId): TimelineStageStatus {
  const stageIndex = STAGE_ORDER.indexOf(id);
  const activeIndex = STAGE_ORDER.indexOf(activeId);
  if (stageIndex < activeIndex) return "done";
  if (stageIndex === activeIndex) return "current";
  return "upcoming";
}

export function buildSessionTimeline({
  stage,
  draft,
  elapsedSec,
  snapshots,
  test,
  review,
  canContinue,
}: BuildTimelineInput): TimelineStage[] {
  const activeId = ACTIVE_STAGE_ID[stage];
  const testText = testEvidence(test);
  const reviewEvidence = review.errorMessage
    ? "评测失败，可保留记录后重试"
    : review.rating
      ? `评级 ${review.rating} 已生成`
      : review.reviewingElapsedSec > 0
        ? `后台评测中，已用 ${review.reviewingElapsedSec}s`
        : "等待后台评测结果";

  const definitions: Record<TimelineStageId, Omit<TimelineStage, "id" | "status">> = {
    prepare: {
      label: STAGE_LABELS.prepare,
      summary: draft ? "本局已创建，记录已开始。" : "选择训练模式和语言后开始本局记录。",
      evidence: draft ? formatDraft(draft) : "尚未创建本局记录",
      actionHint: draft ? "继续作答" : "选择模式开始",
    },
    code: {
      label: STAGE_LABELS.code,
      summary: "编辑器记录真实用时和过程节点。",
      evidence: draft ? `${snapshotEvidence(snapshots)} · 用时 ${formatDuration(elapsedSec)}` : "开始后生成思考节点",
      actionHint: "写出可提交解法",
    },
    test: {
      label: STAGE_LABELS.test,
      summary: "用样例验证当前代码，不替代最终评测。",
      evidence: testText,
      actionHint: test.result?.verdict === "OK" ? "可以提交评测" : "运行样例或继续修正",
      tone: test.result?.verdict === "OK" ? "success" : test.phase === "error" ? "warning" : "default",
    },
    submit: {
      label: STAGE_LABELS.submit,
      summary: "冻结当前代码和过程记录，生成评测输入。",
      evidence: stage === "submitting" || stage === "reviewing" || stage === "reviewed" || stage === "recoverable_error"
        ? "提交记录已创建"
        : "尚未提交",
      actionHint: stage === "submitting" ? "正在提交" : "提交进入评测",
    },
    review: {
      label: STAGE_LABELS.review,
      summary: stage === "recoverable_error" ? "评测异常不会丢失本局记录。" : "后台结合代码、测试和过程记录生成评级。",
      evidence: reviewEvidence,
      actionHint: stage === "recoverable_error" ? "修复配置或重试评测" : "等待评级与复盘",
      tone: stage === "recoverable_error" ? "warning" : review.rating ? "success" : "default",
    },
    recap: {
      label: STAGE_LABELS.recap,
      summary: "把评级和证据转成下一次训练安排。",
      evidence: review.rating
        ? canContinue
          ? `评级 ${review.rating}，可继续优化`
          : `评级 ${review.rating}，复习节奏已更新`
        : "等待评测完成后生成",
      actionHint: canContinue ? "继续优化或查看复习" : "查看处方、复习或下一题",
      tone: review.rating ? "success" : "default",
    },
  };

  return STAGE_ORDER.map((id) => ({
    id,
    status: stageStatus(id, activeId),
    ...definitions[id],
  }));
}
