import styles from "./TierIndicator.module.css";

const TIER_META: Record<number, { label: string; detail: string }> = {
  0: {
    label: "未求助",
    detail: "还没有使用提示阶梯。",
  },
  1: {
    label: "思路方向",
    detail: "校准题意、模式和第一步方向。",
  },
  2: {
    label: "关键观察",
    detail: "指出核心性质、边界和常见坑。",
  },
  3: {
    label: "伪代码骨架",
    detail: "给出结构化步骤，但不替你完成实现。",
  },
  4: {
    label: "完整代码",
    detail: "已到最高提示层，建议之后重做巩固。",
  },
};

interface Props {
  tier: number;
  compact?: boolean;
}

export function TierIndicator({ tier, compact = false }: Props) {
  const safeTier = Math.min(Math.max(Math.floor(tier), 0), 4);
  const meta = TIER_META[safeTier] ?? TIER_META[0];

  return (
    <span
      className={`${styles.indicator} ${compact ? styles.compact : ""}`}
      title={meta.detail}
    >
      <span className={styles.track}>
        {Array.from({ length: 4 }, (_, index) => (
          <span
            key={index}
            className={`${styles.dot} ${index < safeTier ? styles.dotActive : ""}`}
          />
        ))}
      </span>
      <span className={styles.text}>
        {safeTier === 0 ? "未求助" : `第 ${safeTier} 层 / 共 4 层 · ${meta.label}`}
      </span>
    </span>
  );
}
