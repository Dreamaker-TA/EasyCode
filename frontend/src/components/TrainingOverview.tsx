import { Link } from "react-router-dom";

import type { TrainingOverview as TrainingOverviewData } from "@/api/types";
import { useCountUp } from "@/hooks/useCountUp";

import { Button } from "./Button";
import styles from "./TrainingOverview.module.css";

interface Props {
  data: TrainingOverviewData | undefined;
  isLoading: boolean;
  error: unknown;
}

function problemLabel(problem: TrainingOverviewData["recommended_problem"]): string {
  if (!problem) return "暂无推荐题";
  const id = problem.leetcode_id ?? problem.external_id;
  return id ? `${id} · ${problem.title}` : problem.title;
}

const stateTitles: Record<TrainingOverviewData["scheduler_state"], string> = {
  hard_recovery: "先恢复本地训练环境",
  review_recovery: "先处理未完成评测",
  due_review: "先完成到期复习",
  post_review: "先查看这次训练处方",
  recommended_next: "开始今天的推荐题",
  healthy: "今天可以轻量继续训练",
};

function stateTitle(data: TrainingOverviewData): string {
  return stateTitles[data.scheduler_state];
}

function latestRatingText(data: TrainingOverviewData): string {
  if (!data.has_history) return data.state_reason;
  if (!data.recent.latest_rating) return "还没有评级记录";
  const weak = data.recent.weak_category ? ` · 关注 ${data.recent.weak_category}` : "";
  return `最近评级 ${data.recent.latest_rating}${weak}。${data.state_reason}`;
}

/** 主 CTA 变体：恢复类走 danger，其余一律 primary（accent 是唯一 CTA 色，设计规范）。 */
function actionVariant(data: TrainingOverviewData): "primary" | "danger" {
  if (data.scheduler_state === "hard_recovery" || data.scheduler_state === "review_recovery") {
    return "danger";
  }
  return "primary";
}

function stateTone(data: TrainingOverviewData): "danger" | "warn" | "ok" | "neutral" {
  if (data.scheduler_state === "hard_recovery" || data.scheduler_state === "review_recovery") {
    return "danger";
  }
  if (data.scheduler_state === "due_review" || data.scheduler_state === "post_review") {
    return "warn";
  }
  if (data.scheduler_state === "healthy") return "ok";
  return "neutral";
}

export function TrainingOverview({ data, isLoading, error }: Props) {
  const dueTick = useCountUp(data?.due_count ?? 0, {
    enabled: !!data,
  });

  if (isLoading) {
    return (
      <section className={styles.panel} data-qa="training-overview">
        <div className={`${styles.kickerRow} tone-neutral`}>
          <span className={styles.toneMark} />
          <span className="kicker">今日训练</span>
        </div>
        <div className={`skeleton-bar ${styles.loadingLine}`} />
        <div className={styles.loadingGrid}>
          <span className="skeleton-block" />
          <span className="skeleton-block" />
          <span className="skeleton-block" />
        </div>
      </section>
    );
  }

  if (error || !data) {
    return (
      <section
        className={styles.panel}
        data-qa="training-overview"
        data-state="danger"
      >
        <div className={styles.header}>
          <div>
            <div className={`${styles.kickerRow} tone-danger`}>
              <span className={styles.toneMark} />
              <span className="kicker">今日训练处方</span>
            </div>
            <h1 className={styles.title}>训练概览暂时不可用</h1>
            <p className={styles.copy}>
              暂时无法确认今日复习和推荐题。请先确认本地服务正在运行，并检查前端是否连接到了正确的服务地址。
            </p>
          </div>
          <Button as="link" to="/settings" variant="danger" size="lg" className={styles.primaryAction}>
            打开设置诊断
          </Button>
        </div>
        <div className={styles.grid}>
          <div className={styles.tile}>
            <span className={styles.tileLabel}>恢复路径</span>
            <strong className={styles.problemTitle}>检查本地服务连接</strong>
            <span className={styles.tileCopy}>如果前端改用了其他端口，请确认后端允许该地址连接。</span>
          </div>
        </div>
      </section>
    );
  }

  const recommended = data.recommended_problem;
  const tone = stateTone(data);

  return (
    <section
      className={styles.panel}
      data-qa="training-overview"
      data-state={tone}
    >
      <div className={styles.header}>
        <div className={styles.mission}>
          <div className={`${styles.kickerRow} tone-${tone}`}>
            <span className={styles.toneMark} />
            <span className="kicker">今日训练处方</span>
          </div>
          <h1 className={styles.title}>{stateTitle(data)}</h1>
          <p className={styles.copy}>{latestRatingText(data)}</p>
          <div className={styles.factRow} data-qa="training-facts">
            {/* 「待复习」事实已由下方待复习瓦片承载；
                chip 行只保留瓦片外的事实（评测恢复 / 训练记录等）。 */}
            {data.secondary_facts
              .filter((fact) => fact.label !== "待复习")
              .map((fact) => (
                <span key={fact.label} className={`${styles.fact} tone-${fact.tone}`}>
                  <span>{fact.label}</span>
                  <strong>{fact.value}</strong>
                </span>
              ))}
          </div>
        </div>
        <Button
          as="link"
          to={data.primary_target.href}
          variant={actionVariant(data)}
          size="lg"
          className={styles.primaryAction}
        >
          {data.primary_target.label}
        </Button>
      </div>

      <div className={styles.grid}>
        <Link
          to="/review"
          className={`${styles.tile} ${styles.dueTile}`}
          data-qa="due-tile"
        >
          <span className={styles.tileLabel}>待复习</span>
          <strong
            className={styles.tileValue}
            data-changed={dueTick.changed ? "true" : "false"}
          >
            {dueTick.value}
          </strong>
          <span className={styles.tileCopy}>
            {data.due_count > 0 ? "优先完成到期题" : "今天没有逾期题"}
          </span>
        </Link>

        {(data.stale_review_count > 0 || data.review_failed_count > 0) && (
          <Link to={data.primary_target.href} className={`${styles.tile} ${styles.recoveryTile}`}>
            <span className={styles.tileLabel}>评测恢复</span>
            <strong className={styles.tileValue}>
              {data.stale_review_count + data.review_failed_count}
            </strong>
            <span className={styles.tileCopy}>先恢复未完成评测，避免训练记录断档</span>
          </Link>
        )}

        {recommended ? (
          <Link to={`/problem/${recommended.id}`} className={styles.tile}>
            <span className={styles.tileLabel}>推荐下一题</span>
            <strong className={styles.problemTitle}>{problemLabel(recommended)}</strong>
            <span className={styles.tileCopy}>{recommended.reason}</span>
          </Link>
        ) : (
          <Link to="/settings" className={styles.tile}>
            <span className={styles.tileLabel}>推荐下一题</span>
            <strong className={styles.problemTitle}>题库未就绪</strong>
            <span className={styles.tileCopy}>到设置诊断检查导入、seed 和数据库状态</span>
          </Link>
        )}

        <Link to="/history" className={styles.tile}>
          <span className={styles.tileLabel}>近 7 天</span>
          <strong className={styles.tileValue}>{data.recent.submissions_7d}</strong>
          <span className={styles.tileCopy}>
            {data.recent.submissions_7d > 0 ? "次提交已进入历史" : "完成首局后开始记录"}
          </span>
        </Link>
      </div>
    </section>
  );
}
