import styles from "./Skeleton.module.css";

/**
 * 骨架基元。统一 shimmer 来自 globals.css 的
 * .skeleton-bar / .skeleton-block（时长 1.4s、透明度呼吸，不动 width/height）。
 * 组件不再各写 shimmer 关键帧，统一用这里的基元拼形状。
 */

interface BarProps {
  /** 宽度（如 "55%" / "28%"），默认占满。 */
  width?: string;
  /** 高度覆盖，默认 12px（.skeleton-bar 规格）。 */
  height?: number;
  className?: string;
}

/** 单行骨架条。 */
export function SkeletonBar({ width, height, className }: BarProps) {
  return (
    <span
      className={["skeleton-bar", className ?? ""].filter(Boolean).join(" ")}
      style={{ display: "block", width: width ?? "100%", ...(height ? { height } : null) }}
    />
  );
}

/** 方块骨架（徽标 / 头像 / 图形占位）。 */
export function SkeletonBlock({ size = 36, className }: { size?: number; className?: string }) {
  return (
    <span
      className={["skeleton-block", className ?? ""].filter(Boolean).join(" ")}
      style={{ display: "block", width: size, height: size }}
    />
  );
}

/**
 * 段落骨架：标题条 + 若干正文行，用于详情区（评测详情、复习计划等）数据到达前占位，
 * 消除 flash-of-empty。宽度按行递减模拟真实段落。
 */
export function SkeletonLines({ rows = 3, className }: { rows?: number; className?: string }) {
  const widths = ["100%", "92%", "78%", "88%", "64%"];
  return (
    <div className={[styles.lines, className ?? ""].filter(Boolean).join(" ")}>
      <SkeletonBar width="32%" height={14} className={styles.heading} />
      {Array.from({ length: rows }).map((_, i) => (
        <SkeletonBar key={i} width={widths[i % widths.length]} />
      ))}
    </div>
  );
}
