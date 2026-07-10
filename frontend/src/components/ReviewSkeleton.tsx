import styles from "./ReviewSkeleton.module.css";

interface Props {
  phase: "submitting" | "reviewing";
  elapsedSec: number;
}

export function ReviewSkeleton({ phase, elapsedSec }: Props) {
  const caption =
    phase === "submitting"
      ? "正在冻结提交……"
      : `AI 正在评测，已用 ${elapsedSec} 秒；耗时取决于模型、网络和当前等待任务。`;

  return (
    <div className={styles.wrap}>
      <div className={styles.head}>
        <div className={`skeleton-block ${styles.barBadge}`} />
        <div className={`skeleton-bar ${styles.bar}`} style={{ width: "55%" }} />
      </div>
      {Array.from({ length: 5 }).map((_, i) => (
        <div className={styles.row} key={i}>
          <div className={`skeleton-bar ${styles.bar} ${styles.title}`} />
          <div className={`skeleton-bar ${styles.bar} ${styles.line}`} />
          <div className={`skeleton-bar ${styles.bar} ${styles.lineShort}`} />
        </div>
      ))}
      <div className={styles.caption}>{caption}</div>
    </div>
  );
}
