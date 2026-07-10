import type { DueItem } from "@/api/types";

/**
 * 复习优先级色映射单一来源：
 *   must        = danger 淡染（必须优先）
 *   recommended = warn 淡染（建议今天完成）
 *   optional    = neutral 灰（可以顺手巩固）
 * 淡染视觉由全局 tone-* 词汇表（globals.css）承担：
 *   --tone-surface 底 + --tone-border 描边 + --tone-fg 文字。
 * ReviewPlanSummary 的优先级药丸、DueList 的分组标题共用本映射，禁止各处另造。
 */
export type Priority = DueItem["priority"];

export const PRIORITY_TONE: Record<Priority, "danger" | "warn" | "neutral"> = {
  must: "danger",
  recommended: "warn",
  optional: "neutral",
};

/** 元素上要追加的全局 tone 类名。 */
export function priorityToneClass(priority: Priority): string {
  return `tone-${PRIORITY_TONE[priority]}`;
}
