import type { DueItem } from "@/api/types";
import { priorityToneClass } from "@/lib/priorityTone";

import { Button } from "./Button";
import styles from "./ReviewPlanSummary.module.css";

interface Props {
  items: DueItem[];
}

const PRIORITY_LABELS: Record<DueItem["priority"], string> = {
  must: "必须优先",
  recommended: "建议今天完成",
  optional: "可以顺手巩固",
};

export function ReviewPlanSummary({ items }: Props) {
  const total = items.length;
  const minutesMin = total * 8;
  const minutesMax = total * 12;
  const counts = countByPriority(items);
  const topReason = buildTopReason(items);
  const objective = buildObjective(items);

  return (
    <section className={styles.summary}>
      <div className={styles.metric}>
        <span className={`tnum ${styles.metricValue}`}>{total}</span>
        <span className={styles.metricLabel}>今日复习</span>
      </div>
      <div className={styles.metric}>
        <span className={`tnum ${styles.metricValue}`}>
          {total === 0 ? "0" : `${minutesMin}-${minutesMax}`}
        </span>
        <span className={styles.metricLabel}>预计分钟</span>
      </div>
      <div className={styles.plan}>
        {total === 0 ? (
          <>
            <p className={styles.planTitle}>今天没有到期复习</p>
            <p className={styles.planText}>
              可以练一题新的核心题，或去历史里看最近的薄弱分类。
            </p>
            <div className={styles.actions}>
              <Button as="link" to="/" variant="primary" size="md">
                去题库
              </Button>
              <Button as="link" to="/history" variant="secondary" size="md">
                看历史
              </Button>
            </div>
          </>
        ) : (
          <>
            <p className={styles.planTitle}>{topReason}</p>
            <p className={styles.planText}>{objective}</p>
            <div className={styles.priorityGrid}>
              {(Object.keys(PRIORITY_LABELS) as DueItem["priority"][]).map(
                (priority) => (
                  <span
                    key={priority}
                    className={`${styles.priorityPill} ${priorityToneClass(priority)}`}
                  >
                    {PRIORITY_LABELS[priority]}
                    <strong>{counts[priority]}</strong>
                  </span>
                ),
              )}
            </div>
          </>
        )}
      </div>
    </section>
  );
}

function countByPriority(items: DueItem[]): Record<DueItem["priority"], number> {
  return items.reduce(
    (acc, item) => {
      acc[item.priority] += 1;
      return acc;
    },
    { must: 0, recommended: 0, optional: 0 },
  );
}

function buildTopReason(items: DueItem[]): string {
  const mustCount = items.filter((item) => item.priority === "must").length;
  if (mustCount > 0) {
    return `${mustCount} 道题需要优先处理，通常是低评级或逾期较久。`;
  }
  const lowCount = items.filter((item) =>
    item.reason_codes.includes("low_rating"),
  ).length;
  if (lowCount > 0) {
    return `${lowCount} 道题上次评级偏低，今天适合先把解法补稳。`;
  }
  return "今天的复习节奏较轻，按顺序巩固即可。";
}

function buildObjective(items: DueItem[]): string {
  const lowCount = items.filter((item) =>
    item.reason_codes.includes("low_rating"),
  ).length;
  const overdueCount = items.filter((item) => item.days_overdue > 0).length;
  if (lowCount > 0) {
    return "本次目标是先把低评级题重做或补稳，不追求开新题数量。";
  }
  if (overdueCount > 0) {
    return "本次目标是补上逾期复习，优先独立完成题目。";
  }
  return "本次目标是按计划确认掌握度，完成后再回首页选择下一题。";
}
