import type { Rating } from "@/api/types";

/**
 * 评级色带单一来源：
 *   A = ok 绿·实心（稳固通过）
 *   B = ok 绿·浅档（通过但有瑕疵——与 A 同族不同档）
 *   C = warn 琥珀
 *   D = danger 红
 * B 不再使用 accent 橙（橙是品牌动作色，用作评级会与 CTA 混淆）。
 * RatingBadge、雷达维度圆点、维度摘要、历史列表全部经由本映射取色；
 * 颜色本体由 globals.css 的 tone-* 词汇表提供（--tone-fg/--tone-mark/...）。
 */
export type RatingTone = "ok" | "ok-soft" | "warn" | "danger" | "neutral";

export const RATING_TONE: Record<Rating, RatingTone> = {
  A: "ok",
  B: "ok-soft",
  C: "warn",
  D: "danger",
};

/** 徽标展示强度：A 实心盖章；B 淡染 + 浅描边（同族浅档）；C/D 纯描边。 */
export const RATING_EMPHASIS: Record<Rating, "solid" | "soft" | "outline"> = {
  A: "solid",
  B: "soft",
  C: "outline",
  D: "outline",
};

/** 元素上要追加的全局 tone 类名；无评级时回落中性灰。 */
export function ratingToneClass(rating: Rating | null | undefined): string {
  return `tone-${rating ? RATING_TONE[rating] : "neutral"}`;
}
