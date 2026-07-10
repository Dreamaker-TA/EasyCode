import type { Rating, ReviewOutput, SubmissionDetail } from "@/api/types";
import { formatLocalDateStamp, formatLocalDateTime } from "@/lib/datetime";
import type { ReviewDimension } from "@/lib/reviewDimensions";

export interface ReviewExportInfo {
  problemId: number;
  title: string;
  leetcodeId: number | null;
  externalId: string | null;
}

export interface BuildReviewMarkdownInput {
  exportInfo: ReviewExportInfo;
  submission: SubmissionDetail;
  review: ReviewOutput;
  dimensions: ReviewDimension[];
  diagnosis: string;
  effectiveRating: Rating | null;
}

export interface BuildReviewMarkdownOptions {
  includeCode: boolean;
}

const LANGUAGE_FENCE: Record<SubmissionDetail["language"], string> = {
  python: "python",
};

export function buildReviewMarkdown(
  input: BuildReviewMarkdownInput,
  options: BuildReviewMarkdownOptions,
): string {
  const { exportInfo, submission, review, dimensions, diagnosis, effectiveRating } = input;
  const lines: string[] = [
    "# EasyCode 评测报告",
    "",
    `- 题目：${formatProblemTitle(exportInfo)}`,
    `- 提交：${formatDateTime(submission.submitted_at ?? submission.created_at)}`,
    `- 导出：${formatDateTime(new Date())}`,
    `- 语言：${formatLanguage(submission.language)}`,
    "",
    "## 评级",
    "",
    `- 生效评级：${effectiveRating ?? review.rating ?? "无"}`,
    `- AI 自动评级：${review.rating ?? "无"}`,
    `- 编译状态：${review.can_compile ? "编译通过" : "编译未通过"}`,
    "",
    "### 主诊断",
    "",
    diagnosis,
    "",
    "### 评级依据",
    "",
    review.rating_rationale.trim() || "本次没有额外评级依据。",
    "",
    "## 五维深读",
    "",
    ...dimensions.flatMap((dimension) => [
      `### ${dimension.label}`,
      "",
      `- 数值：${dimension.value === null ? "无数据" : `${dimension.value}/100`}`,
      `- 摘要：${dimension.summary}`,
      `- 说明：${dimension.detail}`,
      "",
    ]),
    "## 复杂度",
    "",
    `- 时间复杂度：${review.complexity?.time || "未记录"}`,
    `- 空间复杂度：${review.complexity?.space || "未记录"}`,
    "",
    review.complexity?.explain || "本次没有复杂度说明。",
    "",
    "## 优化建议",
    "",
    ...formatList(review.optimization, "暂无优化建议。"),
    "",
    "## 过程复盘",
    "",
    review.process_review.trim() || "本次未生成过程复盘。",
    "",
  ];

  if (review.compile_issues.length > 0) {
    lines.push("## 编译问题", "", ...formatList(review.compile_issues, "暂无编译问题。"), "");
  }

  if (options.includeCode) {
    const fence = codeFenceFor(submission.code);
    lines.push(
      "## 代码",
      "",
      `${fence}${LANGUAGE_FENCE[submission.language]}`,
      submission.code,
      fence,
      "",
    );
  }

  return `${lines.join("\n").replace(/\n{3,}/g, "\n\n").trim()}\n`;
}

export function buildReviewMarkdownFilename(
  exportInfo: ReviewExportInfo,
  date = new Date(),
): string {
  const id = exportInfo.leetcodeId ?? exportInfo.externalId ?? `problem-${exportInfo.problemId}`;
  return `easycode-review-${sanitizeFilenamePart(String(id))}-${formatLocalDateStamp(date)}.md`;
}

export function downloadTextFile(filename: string, text: string, type: string): void {
  const blob = new Blob([text], { type });
  const href = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.download = filename;
  anchor.style.display = "none";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(href), 0);
}

export function formatProblemTitle(info: ReviewExportInfo): string {
  const id = info.leetcodeId ?? info.externalId ?? info.problemId;
  return `${id}. ${info.title}`;
}

function formatList(items: string[], emptyText: string): string[] {
  const usable = items.map((item) => item.trim()).filter(Boolean);
  return usable.length > 0 ? usable.map((item) => `- ${item}`) : [`- ${emptyText}`];
}

function codeFenceFor(code: string): string {
  const matches = code.match(/`{3,}/g) ?? [];
  const longest = matches.reduce((max, match) => Math.max(max, match.length), 2);
  return "`".repeat(longest + 1);
}

function formatLanguage(language: SubmissionDetail["language"]): string {
  if (language === "python") return "Python";
  return language;
}

function formatDateTime(value: string | Date): string {
  return formatLocalDateTime(value, "");
}

function sanitizeFilenamePart(value: string): string {
  return value.trim().replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "review";
}
