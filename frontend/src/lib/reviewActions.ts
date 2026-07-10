import type { Rating, ReviewOutput, SubmissionDetail } from "@/api/types";
import type { ReviewPhase } from "@/components/ReviewPanel";
import { formatLocalMonthDayTime } from "@/lib/datetime";

export type ReviewActionIntent =
  | "continue"
  | "restart"
  | "replay"
  | "review_plan"
  | "next_problem"
  | "retry_review"
  | "export_review"
  | "settings";

export interface ReviewAction {
  kind: "primary" | "secondary";
  intent: ReviewActionIntent;
  label: string;
  reason: string;
  to?: string;
  /** 导航到 `to` 时携带的 router state（如从题目内跳历史时标记来源）。 */
  state?: Record<string, unknown>;
  disabled?: boolean;
}

export interface ReviewPrescription {
  tone: "ok" | "warn" | "danger" | "neutral";
  title: string;
  detail: string;
  meta?: string;
}

export interface ReviewActionContext {
  phase: ReviewPhase;
  submission: SubmissionDetail | null;
  effectiveRating: Rating | null;
  canContinue: boolean;
  replayHref?: string;
  reviewPlanHref?: string;
  nextProblemHref?: string;
  settingsHref?: string;
  canExport?: boolean;
}

function formatScheduleDate(value: string): string {
  return formatLocalMonthDayTime(value, value);
}

export function getReviewDiagnosis(review: ReviewOutput | null): string {
  if (!review) return "本次还没有可展示的评测结论。";
  if (review.rating_rationale?.trim()) return review.rating_rationale.trim();
  const compileIssue = review.compile_issues.find((line) => line.trim());
  if (!review.can_compile && compileIssue) return compileIssue.trim();
  if (review.quality?.comments?.trim()) return review.quality.comments.trim();
  const optimization = review.optimization.find((line) => line.trim());
  if (optimization) return optimization.trim();
  if (review.process_review?.trim()) return review.process_review.trim();
  return "评测已完成，建议根据评级选择下一步训练动作。";
}

export function buildReviewActions({
  phase,
  submission,
  effectiveRating,
  canContinue,
  replayHref,
  reviewPlanHref = "/review",
  nextProblemHref = "/",
  settingsHref = "/settings",
  canExport = true,
}: ReviewActionContext): ReviewAction[] {
  if (phase === "error") {
    return compact([
      {
        kind: "primary",
        intent: "retry_review",
        label: "重试评测",
        reason: "代码和过程记录已保留，可以直接重新请求评测。",
      },
      settingsHref
        ? {
            kind: "secondary",
            intent: "settings",
            label: "打开设置诊断",
            reason: "检查 AI 评测、本地运行环境和题库状态。",
            to: settingsHref,
          }
        : null,
    ]);
  }

  const review = submission?.review ?? null;
  if (!submission || !review) return [];

  const rating = effectiveRating ?? review.rating;
  // 结算 URL（会话号 URL 化）：/problem/:id?sid=<本次提交>。带上它作为回放 / 复习计划
  // 页面「回到题目」的回程地址，让用户从这些外链页面能精确返回本局结算面板。
  const backToProblem = `/problem/${submission.problem_id}?sid=${encodeURIComponent(
    submission.id,
  )}`;
  const replayAction: ReviewAction = {
    kind: "secondary",
    intent: "replay",
    label: "看过程回放",
    reason: "按时间线复盘卡点和修改轨迹。",
    to: replayHref,
    // 从题目内评测面板跳历史 → 标记来源 + 回程结算地址，历史页据此显示"回到题目"。
    state: { fromProblem: true, backToProblem },
    disabled: !replayHref,
  };
  const reviewPlanAction: ReviewAction = {
    kind: "secondary",
    intent: "review_plan",
    label: "查看复习计划",
    reason: "确认这次评级进入了哪个复习节奏。",
    to: reviewPlanHref,
    // 同样带回程结算地址，复习页据此显示"回到题目"。
    state: { fromProblem: true, backToProblem },
  };
  const nextAction: ReviewAction = {
    kind: "secondary",
    intent: "next_problem",
    label: "下一题",
    reason: "把当前训练记录收束，进入下一次练习。",
    to: nextProblemHref,
  };
  const exportAction = canExport ? buildReviewExportAction(review) : null;

  if ((rating === "C" || rating === "D") && canContinue) {
    return compact([
      {
        kind: "primary",
        intent: "continue",
        label: rating === "D" ? "继续修正" : "继续优化",
        reason:
          rating === "D"
            ? "沿用本次用时和过程记录，直接修正 D 级问题。"
            : "沿用本次用时和过程记录，直接修正 C 级问题。",
      },
      exportAction,
      replayAction,
      reviewPlanAction,
    ]);
  }

  if (!review.can_compile) {
    return compact([
      {
        kind: "primary",
        intent: "restart",
        label: "重新作答",
        reason: "先恢复到可运行版本，再进入下一次评测。",
      },
      exportAction,
      replayAction,
      reviewPlanAction,
    ]);
  }

  if (rating === "D" || rating === "C") {
    return compact([
      {
        kind: "primary",
        intent: "restart",
        label: "重新作答",
        reason: "",
      },
      exportAction,
      replayAction,
      reviewPlanAction,
    ]);
  }

  if (rating === "B") {
    return compact([
      {
        ...replayAction,
        kind: "primary",
        reason: "先把 B 级卡点整理成薄弱点，再进入下一题。",
      },
      exportAction,
      { ...nextAction, kind: "secondary" },
      reviewPlanAction,
    ]);
  }

  return compact([
    { ...nextAction, kind: "primary" },
    exportAction,
    replayAction,
    reviewPlanAction,
  ]);
}

export function buildReviewExportAction(review: ReviewOutput | null): ReviewAction | null {
  if (!review || review.error) return null;
  return {
    kind: "secondary",
    intent: "export_review",
    label: "导出",
    reason: "导出 Markdown 报告，或生成不含代码的 PNG 分享卡片。",
  };
}

export function buildReviewPrescription({
  phase,
  submission,
  effectiveRating,
}: Pick<ReviewActionContext, "phase" | "submission" | "effectiveRating">): ReviewPrescription | null {
  const review = submission?.review ?? null;
  if (!submission || !review) return null;

  if (phase === "error" || submission.status === "review_failed" || review.error) {
    return {
      tone: "danger",
      title: "本次未写入复习计划",
      detail: "评测失败不会改动复习计划。代码和过程记录已保留，可以重试评测或先检查设置诊断。",
      meta: submission.review_last_error_code ?? review.error_code ?? undefined,
    };
  }

  const rating = effectiveRating ?? review.rating;
  if (!rating) {
    return {
      tone: "neutral",
      title: "还没有评分",
      detail: "这次还没拿到评分；可以重试评测，或先检查设置。",
    };
  }

  const schedule = submission.review_schedule;
  if (!schedule) {
    return {
      tone: "neutral",
      title: "这条记录不是当前最新排程来源",
      detail: "每道题只保留最新的复习安排；请以复习页显示的当前计划为准。",
    };
  }

  const next = formatScheduleDate(schedule.next_review_at);
  const interval = `${schedule.interval_days} 天间隔`;
  if (!review.can_compile || rating === "D") {
    return {
      tone: "danger",
      title: `下一次复习：${next}`,
      detail: "本次评分把题目放回短间隔。先修正基础错误，再重新提交评测。",
      meta: interval,
    };
  }
  if (rating === "C") {
    return {
      tone: "warn",
      title: `下一次复习：${next}`,
      detail: "本次评分说明解法还不稳定，系统保留短间隔；今天适合继续优化或重做一次。",
      meta: interval,
    };
  }
  if (rating === "B") {
    return {
      tone: "ok",
      title: `下一次复习：${next}`,
      detail: "本次评分已进入中等间隔。先整理一个卡点，再进入下一题更稳。",
      meta: interval,
    };
  }
  return {
    tone: "ok",
    title: `下一次复习：${next}`,
    detail: "本次评分已进入更长间隔，可以把当前题收束后继续下一题。",
    meta: interval,
  };
}

function compact<T>(items: Array<T | null>): T[] {
  return items.filter((item): item is T => item !== null);
}
