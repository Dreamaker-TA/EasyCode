import { Link, useLocation } from "react-router-dom";

import type { DueItem } from "@/api/types";
import { priorityToneClass } from "@/lib/priorityTone";

import { EmptyState } from "./EmptyState";
import { RatingBadge } from "./RatingBadge";
import styles from "./DueList.module.css";

/** 复习队列清空空态文案（全站唯一，QA 锁定；DueList 与 ReviewDuePage 共用一处）。 */
export const REVIEW_QUEUE_EMPTY_MESSAGE =
  "复习队列已清空，今天没有到期的题。可以开一题新训练，或从历史里挑一个薄弱分类巩固。";

interface Props {
  items: DueItem[];
}

const PRIORITY_LABELS: Record<DueItem["priority"], string> = {
  must: "必须优先",
  recommended: "建议今天完成",
  optional: "可以顺手巩固",
};

const PRIORITY_ORDER: DueItem["priority"][] = [
  "must",
  "recommended",
  "optional",
];

export function DueList({ items }: Props) {
  const location = useLocation();
  const fromPath = location.pathname + location.search;

  if (items.length === 0) {
    return (
      <EmptyState
        kicker="复习队列"
        message={REVIEW_QUEUE_EMPTY_MESSAGE}
        action={{ label: "去题库开新题", to: "/" }}
      />
    );
  }

  return (
    <div className={styles.wrap}>
      {PRIORITY_ORDER.map((priority) => {
        const group = items.filter((item) => item.priority === priority);
        if (group.length === 0) return null;
        return (
          <section key={priority} className={`${styles.group} ${priorityToneClass(priority)}`}>
            <div className={styles.groupHeader}>
              <div>
                <h2>{PRIORITY_LABELS[priority]}</h2>
                <p>{priorityGoal(priority, group)}</p>
              </div>
              <span>{group.length} 题</span>
            </div>
            {group.map((it) => {
              const overdue = it.days_overdue > 0;
              // 主行只承载题号+标题+评级徽标+到期；理由 + 本次目标合成一行截断（ellipsis），
              // 完整文案由 title 属性给出。
              const reason = `${reasonText(it)} · 本次目标：${targetText(it)}`;
              return (
                <Link
                  to={`/problem/${it.problem_id}`}
                  state={{ from: fromPath }}
                  key={it.problem_id}
                  className={styles.row}
                >
                  <span className={styles.id}>
                    {it.leetcode_id ?? it.external_id ?? "—"}
                  </span>
                  <span className={styles.main}>
                    <span className={styles.title}>{it.title}</span>
                    <span className={styles.reason} title={reason}>
                      {reason}
                    </span>
                  </span>
                  <span className={styles.category}>{it.category}</span>
                  <span className={styles.badgeCell}>
                    <RatingBadge
                      effective={it.effective_rating}
                      userRating={null}
                      autoRating={it.effective_rating}
                      readOnly
                      compact
                    />
                  </span>
                  <span className={overdue ? styles.overdue : styles.onTime}>
                    {overdue ? `逾期 ${it.days_overdue} 天` : "今日到期"}
                  </span>
                </Link>
              );
            })}
          </section>
        );
      })}
    </div>
  );
}

function priorityGoal(priority: DueItem["priority"], group: DueItem[]): string {
  const lowCount = group.filter((item) =>
    item.reason_codes.includes("low_rating"),
  ).length;
  if (priority === "must") {
    return lowCount > 0
      ? "先处理低评级或久拖题，目标是恢复可独立写出的解法。"
      : "先把逾期最久的题拉回节奏，避免遗忘继续累积。";
  }
  if (priority === "recommended") {
    return "按今天到期顺序确认掌握度，遇到卡点就重做一遍。";
  }
  return "用较轻量的复盘巩固手感，不需要把它当作主训练。";
}

function reasonText(item: DueItem): string {
  const parts: string[] = [];
  if (item.reason_codes.includes("long_overdue")) {
    parts.push("已经拖过一周，需要先恢复手感");
  } else if (item.days_overdue > 0) {
    parts.push(`比计划晚了 ${item.days_overdue} 天`);
  } else {
    parts.push("按间隔今天复习");
  }

  if (item.reason_codes.includes("low_rating")) {
    parts.push("上次评级偏低");
  } else if (item.reason_codes.includes("medium_rating")) {
    parts.push("上次还有可优化点");
  } else if (item.reason_codes.includes("strong_rating")) {
    parts.push("上次掌握较稳");
  }

  if (item.interval_days !== null) {
    parts.push(`间隔 ${item.interval_days} 天`);
  }
  return parts.join(" · ");
}

function targetText(item: DueItem): string {
  if (item.effective_rating === "D") {
    return "先补齐正确性，写出能稳定运行的基础版本";
  }
  if (item.effective_rating === "C") {
    return "补稳边界和复杂度，争取升到 B";
  }
  if (item.effective_rating === "B") {
    return "确认卡点已经消失，再进入更长间隔";
  }
  if (item.effective_rating === "A") {
    return "快速复现核心思路，避免长期遗忘";
  }
  return "完成一次独立复现，重新生成评级";
}
