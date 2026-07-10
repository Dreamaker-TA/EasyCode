import type {
  Rating,
  ReviewDimensionLevel,
  ReviewOutput,
  SubmissionDetail,
} from "@/api/types";
import { RATING_TONE, type RatingTone } from "@/lib/ratingColor";

export type ReviewDimensionKey =
  | "correctness"
  | "complexity"
  | "quality"
  | "process"
  | "guidance";

/** 与评级色带共用同一 tone 词汇表（含 ok-soft = 评级 B 档浅绿，设计规范）。 */
export type ReviewDimensionTone = RatingTone;

export interface ReviewDimension {
  key: ReviewDimensionKey;
  label: string;
  value: number | null;
  available: boolean;
  status: ReviewDimensionTone;
  tone: ReviewDimensionTone;
  summary: string;
  detail: string;
}

type DraftReviewDimension = Omit<ReviewDimension, "status"> & {
  status?: ReviewDimensionTone;
};

interface ReviewPrescriptionLike {
  title: string;
  detail: string;
  tone?: ReviewDimensionTone;
  meta?: string;
}

export interface BuildReviewDimensionsInput {
  submission: SubmissionDetail | null;
  review: ReviewOutput | null;
  effectiveRating?: Rating | null;
  prescription?: ReviewPrescriptionLike | null;
}

const RATING_VALUE: Record<Rating, number> = {
  A: 88,
  B: 76,
  C: 55,
  D: 28,
};

/** 五级等级 → 雷达半径（固定网格）。除正确性外的四维由 LLM 直接给等级时走这里。 */
const LEVEL_VALUE: Record<ReviewDimensionLevel, number> = {
  excellent: 100,
  good: 80,
  fair: 60,
  weak: 40,
  poor: 20,
};

/** 圆点色与评级色带对齐：excellent=ok 实、good=ok 浅（对应 A 实 / B 浅的区分）。 */
const LEVEL_TONE: Record<ReviewDimensionLevel, ReviewDimensionTone> = {
  excellent: "ok",
  good: "ok-soft",
  fair: "warn",
  weak: "danger",
  poor: "danger",
};

const LEVEL_LABEL: Record<ReviewDimensionLevel, string> = {
  excellent: "优秀",
  good: "良好",
  fair: "合格",
  weak: "欠佳",
  poor: "差",
};

function isLevel(value: unknown): value is ReviewDimensionLevel {
  return (
    value === "excellent" ||
    value === "good" ||
    value === "fair" ||
    value === "weak" ||
    value === "poor"
  );
}

const DIMENSION_ORDER: Array<Pick<ReviewDimension, "key" | "label">> = [
  { key: "correctness", label: "正确性" },
  { key: "complexity", label: "复杂度" },
  { key: "quality", label: "代码质量" },
  { key: "process", label: "过程" },
  { key: "guidance", label: "建议" },
];

export function buildReviewDimensions({
  submission,
  review,
  effectiveRating = null,
  prescription = null,
}: BuildReviewDimensionsInput): ReviewDimension[] {
  if (!review) return unavailableDimensions("本次还没有可展示的评测结论。");

  if (submission?.status === "review_failed" || review.error) {
    const code = submission?.review_last_error_code ?? review.error_code ?? "REVIEW_FAILED";
    return unavailableDimensions(`评测失败，没有生成五维摘要。错误码：${code}`);
  }

  const rating = effectiveRating ?? review.rating;
  return finalizeDimensions([
    buildCorrectnessDimension(review, rating),
    buildComplexityDimension(review, rating),
    buildQualityDimension(review),
    buildProcessDimension(review, submission),
    buildGuidanceDimension(review, prescription, submission),
  ]);
}

function unavailableDimensions(detail: string): ReviewDimension[] {
  return finalizeDimensions(DIMENSION_ORDER.map(({ key, label }) => ({
    key,
    label,
    value: null,
    available: false,
    tone: "neutral",
    summary: "暂无数据",
    detail,
  })));
}

function buildCorrectnessDimension(
  review: ReviewOutput,
  rating: Rating | null,
): DraftReviewDimension {
  if (!review.can_compile) {
    return {
      key: "correctness",
      label: "正确性",
      value: LEVEL_VALUE.poor,
      available: true,
      tone: "danger",
      summary: "编译未通过",
      detail: firstText(review.compile_issues) ?? "代码没有进入可运行状态，正确性不作乐观估计。",
    };
  }

  if (!rating) {
    return {
      key: "correctness",
      label: "正确性",
      value: null,
      available: false,
      tone: "neutral",
      summary: "无测试证据",
      detail: "当前没有独立正确性分数，也没有可用评级；不生成推断值。",
    };
  }

  return {
    key: "correctness",
    label: "正确性",
    value: Math.min(RATING_VALUE[rating], 82),
    available: true,
    tone: RATING_TONE[rating],
    summary: `评级 ${rating} 的保守估计`,
    detail: review.rating_rationale || "没有执行结果证据，雷达值仅由评级和编译状态保守映射。",
  };
}

function buildComplexityDimension(
  review: ReviewOutput,
  rating: Rating | null,
): DraftReviewDimension {
  const time = textOrNull(review.complexity?.time);
  const space = textOrNull(review.complexity?.space);
  const explain = textOrNull(review.complexity?.explain);
  if (!time && !space && !explain) {
    return {
      key: "complexity",
      label: "复杂度",
      value: null,
      available: false,
      tone: "neutral",
      summary: "复杂度缺失",
      detail: "本次评测没有稳定的时间/空间复杂度说明，不生成推断值。",
    };
  }

  const label = [time ? `时间 ${time}` : null, space ? `空间 ${space}` : null]
    .filter(Boolean)
    .join("，");

  const level = review.complexity?.level;
  if (isLevel(level)) {
    return {
      key: "complexity",
      label: "复杂度",
      value: LEVEL_VALUE[level],
      available: true,
      tone: LEVEL_TONE[level],
      summary: label || LEVEL_LABEL[level],
      detail: explain ?? `复杂度评级：${LEVEL_LABEL[level]}。`,
    };
  }

  // 无 level：回退到按评级 + 优化建议保守映射。
  const hasOptimization = review.optimization.some((line) => textOrNull(line));
  const value = rating
    ? Math.min(RATING_VALUE[rating] + (hasOptimization ? -8 : 4), 88)
    : 58;
  const tone = rating ? RATING_TONE[rating] : hasOptimization ? "warn" : "neutral";

  return {
    key: "complexity",
    label: "复杂度",
    value: clamp(value),
    available: true,
    tone,
    summary: label || "有复杂度说明",
    detail: explain ?? "复杂度有描述但没有独立分数，雷达值按评级保守映射。",
  };
}

function buildQualityDimension(review: ReviewOutput): DraftReviewDimension {
  const rawScore = review.quality?.score;
  const score = typeof rawScore === "number" && Number.isFinite(rawScore) ? rawScore : null;
  const comments = textOrNull(review.quality?.comments);

  const level = review.quality?.level;
  if (isLevel(level)) {
    return {
      key: "quality",
      label: "代码质量",
      value: LEVEL_VALUE[level],
      available: true,
      tone: LEVEL_TONE[level],
      summary: score !== null ? `${LEVEL_LABEL[level]} · ${score}/10` : LEVEL_LABEL[level],
      detail: comments ?? `代码质量评级：${LEVEL_LABEL[level]}。`,
    };
  }

  // 无 level：回退到 quality.score × 10。
  if (score === null) {
    return {
      key: "quality",
      label: "代码质量",
      value: null,
      available: false,
      tone: "neutral",
      summary: "质量评分缺失",
      detail: "本次评测没有 quality.score，不生成质量雷达值。",
    };
  }

  const normalized = clamp(score * 10);
  return {
    key: "quality",
    label: "代码质量",
    value: normalized,
    available: true,
    tone: normalized >= 75 ? "ok" : normalized >= 50 ? "warn" : "danger",
    summary: `${score}/10`,
    detail: comments ?? "质量评分来自 ReviewOutput.quality.score。",
  };
}

function buildProcessDimension(
  review: ReviewOutput,
  submission: SubmissionDetail | null,
): DraftReviewDimension {
  const process = textOrNull(review.process_review);
  const snapshots = submission?.snapshots_count ?? 0;
  const elapsed = submission?.elapsed_sec ?? 0;
  if (!process && snapshots <= 0 && elapsed <= 0) {
    return {
      key: "process",
      label: "过程",
      value: null,
      available: false,
      tone: "neutral",
      summary: "过程记录缺失",
      detail: "没有过程复盘、思考节点或用时记录，不生成过程雷达值。",
    };
  }

  const summary = snapshots > 0 ? `${snapshots} 个思考节点` : "过程信息有限";
  const detail = process ?? `记录了 ${formatDuration(elapsed)} 用时，但本次未生成文字复盘。`;

  const level = review.process_level;
  if (isLevel(level)) {
    return {
      key: "process",
      label: "过程",
      value: LEVEL_VALUE[level],
      available: true,
      tone: LEVEL_TONE[level],
      summary,
      detail,
    };
  }

  // 无 level：回退到按"有无复盘 + 有无快照"分桶。
  const value = process ? (snapshots > 0 ? 76 : 64) : 48;
  return {
    key: "process",
    label: "过程",
    value,
    available: true,
    tone: value >= 70 ? "ok" : "warn",
    summary,
    detail,
  };
}

function buildGuidanceDimension(
  review: ReviewOutput,
  prescription: ReviewPrescriptionLike | null,
  submission: SubmissionDetail | null,
): DraftReviewDimension {
  const suggestions = review.optimization.filter((line) => textOrNull(line));
  const schedule = submission?.review_schedule;
  if (suggestions.length === 0 && !prescription && !schedule) {
    return {
      key: "guidance",
      label: "建议",
      value: null,
      available: false,
      tone: "neutral",
      summary: "暂无可执行建议",
      detail: "没有优化建议、处方或复习排程，不生成建议雷达值。",
    };
  }

  const summary = suggestions.length > 0 ? `${suggestions.length} 条下一步` : "复习安排可用";
  const detail =
    firstText(suggestions) ?? prescription?.detail ?? "已有复习排程，但没有额外优化建议。";

  const level = review.guidance_level;
  if (isLevel(level)) {
    return {
      key: "guidance",
      label: "建议",
      value: LEVEL_VALUE[level],
      available: true,
      tone: prescription?.tone ?? LEVEL_TONE[level],
      summary,
      detail,
    };
  }

  // 无 level：回退到按建议条数 + 有无复习排程加权。
  const value = clamp(48 + Math.min(suggestions.length, 3) * 12 + (schedule ? 10 : 0));
  return {
    key: "guidance",
    label: "建议",
    value,
    available: true,
    tone: prescription?.tone ?? (suggestions.length > 0 ? "ok" : "neutral"),
    summary,
    detail,
  };
}

function finalizeDimensions(dimensions: DraftReviewDimension[]): ReviewDimension[] {
  return dimensions.map((dimension) => ({
    ...dimension,
    status: dimension.status ?? dimension.tone,
  }));
}

function textOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function firstText(values: readonly string[] | undefined): string | null {
  return values?.map(textOrNull).find((value): value is string => value !== null) ?? null;
}

function clamp(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "0 秒";
  if (seconds < 60) return `${Math.floor(seconds)} 秒`;
  const minutes = Math.floor(seconds / 60);
  const rest = Math.floor(seconds % 60);
  return rest ? `${minutes} 分 ${rest} 秒` : `${minutes} 分`;
}
