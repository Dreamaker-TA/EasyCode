import { Link } from "react-router-dom";

import type { GrowthStats, Rating } from "@/api/types";
import { ratingToneClass } from "@/lib/ratingColor";

import { RatingBadge } from "./RatingBadge";
import styles from "./GrowthSummary.module.css";

interface Props {
  stats: GrowthStats;
}

const RATINGS: Rating[] = ["A", "B", "C", "D"];

export function GrowthSummary({ stats }: Props) {
  const strongCount = stats.rating_counts.A + stats.rating_counts.B;
  const lowCount = stats.rating_counts.C + stats.rating_counts.D;
  const trendText = buildTrendText(stats.submissions, strongCount, lowCount);
  const maxDaily = Math.max(
    1,
    ...stats.daily_submissions.map((item) => item.submissions),
  );

  return (
    <section className={styles.summary}>
      <div className={styles.metric}>
        <span className={`tnum ${styles.metricValue}`}>{stats.submissions}</span>
        <span className={styles.metricLabel}>近 {stats.window_days} 天提交</span>
      </div>
      <div className={styles.metric}>
        <span className={`tnum ${styles.metricValue}`}>{strongCount}</span>
        <span className={styles.metricLabel}>A/B 稳定通过</span>
      </div>
      <div className={styles.metric}>
        <span className={`tnum ${styles.metricValue}`}>{stats.review_due_count}</span>
        <span className={styles.metricLabel}>当前待复习</span>
      </div>

      <div className={styles.panel}>
        <p className={styles.panelTitle}>{trendText}</p>
        <div className={styles.dailyBars}>
          {stats.daily_submissions.map((item) => (
            <span key={item.date} className={styles.day}>
              <span
                className={styles.bar}
                style={{ height: `${Math.max(10, (item.submissions / maxDaily) * 48)}px` }}
              />
              <span className={styles.dayLabel}>{shortDay(item.date)}</span>
              <span className={styles.srOnly}>{item.date} 提交 {item.submissions} 次</span>
            </span>
          ))}
        </div>
      </div>

      <div className={styles.panel}>
        <p className={styles.panelTitle}>评级分布</p>
        <div className={styles.ratingRows}>
          {RATINGS.map((rating) => (
            <div
              key={rating}
              className={`${styles.ratingRow} ${ratingToneClass(rating)}`}
            >
              <RatingBadge
                effective={rating}
                userRating={null}
                autoRating={rating}
                readOnly
                compact
                title={`评级 ${rating} 分布`}
              />
              <span className={styles.track}>
                <span
                  className={styles.fill}
                  style={{
                    width: `${ratio(stats.rating_counts[rating], stats.submissions)}%`,
                  }}
                />
              </span>
              <span className={styles.ratingCount}>
                {stats.rating_counts[rating]} · {ratio(stats.rating_counts[rating], stats.submissions)}%
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className={styles.panel}>
        <p className={styles.panelTitle}>薄弱点</p>
        {stats.weak_categories.length === 0 ? (
          <p className={styles.muted}>还没有明显低评级分类。</p>
        ) : (
          <div className={styles.chips}>
            {stats.weak_categories.map((item) => (
              <span key={item.category} className={styles.chip}>
                {item.category}
                <strong>{item.low_rating_count}</strong>
              </span>
            ))}
          </div>
        )}
      </div>

      <div className={styles.panel}>
        <p className={styles.panelTitle}>重复提交最多</p>
        {stats.most_retried_problems.length === 0 ? (
          <p className={styles.muted}>暂时没有反复卡住的题。</p>
        ) : (
          <div className={styles.retryList}>
            {stats.most_retried_problems.map((item) => (
              <Link
                key={item.problem_id}
                to={`/history/${item.problem_id}`}
                className={styles.retryLink}
              >
                <span>{item.title}</span>
                <strong>×{item.submissions_count}</strong>
              </Link>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function ratio(count: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((count / total) * 100);
}

function shortDay(isoDate: string): string {
  const d = new Date(`${isoDate}T00:00:00`);
  if (Number.isNaN(d.getTime())) return isoDate.slice(5);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function buildTrendText(
  submissions: number,
  strongCount: number,
  lowCount: number,
): string {
  if (submissions === 0) {
    return "近 7 天还没有新的训练记录。";
  }
  if (strongCount >= lowCount) {
    return "近期稳定评级更多，训练节奏在变稳。";
  }
  return "近期 C/D 偏多，先复盘薄弱点比继续刷量更重要。";
}
