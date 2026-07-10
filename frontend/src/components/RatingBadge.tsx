import { useEffect, useRef, useState } from "react";

import type { Rating } from "@/api/types";
import { RATING_EMPHASIS, RATING_TONE, ratingToneClass } from "@/lib/ratingColor";

import styles from "./RatingBadge.module.css";

interface Props {
  /** 当前生效评级（user_rating ?? auto_rating） */
  effective: Rating | null;
  /** 用户覆盖（非 null 表示已覆盖自动评级） */
  userRating: Rating | null;
  /** AI 给出的自动评级 */
  autoRating: Rating | null;
  /** 点击 A/B/C/D 或选“还原自动评级”（传 null）。只读场景可省略。 */
  onPick?: (next: Rating | null) => void;
  /** 是否在提交 PATCH 中（提交时整个 badge 不可点） */
  loading?: boolean;
  /** 只读:badge 显示但不能展开菜单(历史详情页/列表复用) */
  readOnly?: boolean;
  /** 紧凑档（22px，列表行内用）；默认 36px。 */
  compact?: boolean;
  /** tooltip 覆盖（如题库列表的"用户覆盖"说明）；缺省按覆盖状态生成。 */
  title?: string;
}

const ALL_RATINGS: Rating[] = ["A", "B", "C", "D"];

/** 徽标外观类：tone 全局词汇表取色 + A 实心 / B 浅档 / C·D 描边。 */
function badgeAppearance(rating: Rating | null): string {
  const emphasis = rating ? styles[RATING_EMPHASIS[rating]] : "";
  return `${ratingToneClass(rating)} ${emphasis}`.trim();
}

export function RatingBadge({
  effective,
  userRating,
  autoRating,
  onPick,
  loading = false,
  readOnly = false,
  compact = false,
  title: titleOverride,
}: Props) {
  const [open, setOpen] = useState(false);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    positionMenu();
    const onDoc = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) closeMenu();
    };
    const onReposition = () => positionMenu();
    window.addEventListener("mousedown", onDoc);
    window.addEventListener("resize", onReposition);
    window.addEventListener("scroll", onReposition, true);
    return () => {
      window.removeEventListener("mousedown", onDoc);
      window.removeEventListener("resize", onReposition);
      window.removeEventListener("scroll", onReposition, true);
    };
  }, [open]);

  const label = effective ?? "—";
  const overridden = userRating !== null;
  const title =
    titleOverride ?? (overridden ? `已手动覆盖自动评级（原评级：${autoRating ?? "—"}）` : "自动评级");
  const badgeClassName = [
    styles.badge,
    badgeAppearance(effective),
    compact ? styles.compact : "",
  ]
    .filter(Boolean)
    .join(" ");

  // 只读展示：渲染 span（可安全嵌入列表行按钮 / Link），无菜单、无盖章动效。
  if (readOnly) {
    return (
      <span
        className={badgeClassName}
        data-stamp-state="static"
        data-qa="rating-badge"
        title={title}
      >
        <span className={styles.letter}>{label}</span>
        {overridden && <span className={styles.overrideDot} />}
      </span>
    );
  }

  function positionMenu() {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const menuWidth = 190;
    const padding = 8;
    const left = Math.min(
      Math.max(padding, rect.left),
      Math.max(padding, window.innerWidth - menuWidth - padding),
    );
    setMenuPos({ top: rect.bottom + 6, left });
  }

  function openMenu() {
    if (loading) return;
    setOpen(true);
  }

  function closeMenu() {
    setOpen(false);
  }

  function pick(next: Rating | null) {
    onPick?.(next);
    closeMenu();
  }

  return (
    <div className={styles.wrap} ref={wrapRef}>
      <button
        ref={triggerRef}
        type="button"
        className={`${badgeClassName} ${effective ? styles.stampReady : ""}`}
        data-stamp-state={effective ? "ready" : "static"}
        data-qa="rating-menu-trigger"
        onClick={() => {
          if (open) closeMenu();
          else openMenu();
        }}
        disabled={loading}
        title={title}
      >
        <span className={styles.letter}>{label}</span>
        {overridden && <span className={styles.overrideDot} />}
      </button>

      {open && (
        <div
          className={styles.menu}
          data-qa="rating-menu"
          style={menuPos ? { top: menuPos.top, left: menuPos.left } : undefined}
        >
          {ALL_RATINGS.map((r) => (
            <button
              key={r}
              type="button"
              className={styles.option}
              data-active={userRating === r}
              onClick={() => {
                pick(r);
              }}
              disabled={loading}
            >
              <span className={`${styles.optionLetter} tone-${RATING_TONE[r]}`}>{r}</span>
              <span>覆盖为 {r}</span>
              {userRating === r && <span className={styles.optionHint}>当前</span>}
            </button>
          ))}
          <div className={styles.divider} />
          <button
            type="button"
            className={styles.option}
            onClick={() => {
              pick(null);
            }}
            disabled={loading || userRating === null}
          >
            <span className={styles.optionLetter}>AI</span>
            <span>还原自动评级</span>
            {autoRating && <span className={styles.optionHint}>原评级：{autoRating}</span>}
          </button>
        </div>
      )}
    </div>
  );
}
