import { Link, useLocation } from "react-router-dom";

import { DueList } from "@/components/DueList";
import { ErrorNotice } from "@/components/ErrorNotice";
import { ReviewPlanSummary } from "@/components/ReviewPlanSummary";
import { SkeletonLines } from "@/components/Skeleton";
import { useReviewsDue } from "@/hooks/useReviewsDue";
import { toAppError } from "@/lib/errors";

import styles from "./ReviewDuePage.module.css";

export function ReviewDuePage() {
  const { data, isLoading, error } = useReviewsDue();
  const count = data?.items.length ?? 0;
  const location = useLocation();
  // 从评测面板「查看复习计划」进来时会带上本局结算 URL（/problem/:id?sid=），
  // 据此显示"回到题目"，让用户看完复习节奏后能精确返回本局结算面板。
  const backToProblem = (location.state as { backToProblem?: string } | null)
    ?.backToProblem;

  return (
    <div className={styles.page}>
      <header className={styles.head}>
        {backToProblem && (
          <div className={styles.crumbs}>
            <Link
              to={backToProblem}
              className={`${styles.crumbLink} ${styles.crumbPrimary}`}
            >
              ← 回到题目
            </Link>
          </div>
        )}
        <h1 className={styles.title}>今日待复习</h1>
        {/* 错误时副标题留空，错误只在下方 ErrorNotice 面板呈现一处（不重复）。 */}
        {!error && (
          <p className={styles.subtitle}>
            {isLoading
              ? "正在整理今天的复习计划……"
              : count === 0
                ? "今天没有到期的复习题。"
                : `${count} 道题已按优先级排好，先处理低评级和逾期较久的题。`}
          </p>
        )}
      </header>

      {error && (
        <ErrorNotice
          error={toAppError(error, {
            title: "复习计划没有加载成功",
            message: "请确认后端正在运行；如果刚重新导入题库，请刷新后再试。",
          })}
          variant="panel"
        />
      )}

      {isLoading && !data && (
        <div className={styles.loadingRegion}>
          <SkeletonLines rows={2} />
          <SkeletonLines rows={4} />
        </div>
      )}

      {data && (
        <>
          <ReviewPlanSummary items={data.items} />
          <DueList items={data.items} />
        </>
      )}
    </div>
  );
}
