import { useState } from "react";

import type { Rating, SubmissionDetail } from "@/api/types";
import type { ReviewProgressEvent } from "@/hooks/useReviewProgress";
import type { AppErrorView } from "@/lib/errors";
import { reviewErrorToAppError } from "@/lib/errors";
import {
  buildReviewActions,
  buildReviewExportAction,
  buildReviewPrescription,
  getReviewDiagnosis,
  type ReviewAction,
} from "@/lib/reviewActions";
import { buildReviewDimensions } from "@/lib/reviewDimensions";
import type { ReviewExportInfo } from "@/lib/reviewExportMarkdown";

import { Button } from "./Button";
import { ErrorNotice } from "./ErrorNotice";
import { RatingBadge } from "./RatingBadge";
import { ReviewActionFooter } from "./ReviewActionFooter";
import { ReviewDetails } from "./ReviewDetails";
import { ReviewExportDialog, type ReviewExportPanel } from "./ReviewExportDialog";
import { ReviewOverview } from "./ReviewOverview";
import { ReviewProgressTimeline } from "./ReviewProgressTimeline";
import { ReviewSkeleton } from "./ReviewSkeleton";
import styles from "./ReviewPanel.module.css";

export type ReviewPhase = "idle" | "submitting" | "reviewing" | "done" | "error";

interface Props {
  phase: ReviewPhase;
  /** reviewing 阶段已用秒数（驱动骨架文案） */
  reviewingElapsedSec: number;
  progressEvents?: ReviewProgressEvent[];
  progressUnavailable?: boolean;
  /** done/error 时存在 */
  submission: SubmissionDetail | null;
  errorMessage: string | null;
  errorView?: AppErrorView | null;
  /** 用户覆盖评级（done 时可点；其他阶段不渲染 badge） */
  userRating: Rating | null;
  autoRating: Rating | null;
  effectiveRating: Rating | null;
  /** 评级覆盖 PATCH pending */
  ratingPending: boolean;
  onPickRating: (next: Rating | null) => void;
  /** 评测失败时重试 */
  onRetryReview: () => void;
  retryPending: boolean;
  canContinue?: boolean;
  onContinue?: () => void;
  onRestart?: () => void;
  replayHref?: string;
  reviewPlanHref?: string;
  nextProblemHref?: string;
  /** 只读:历史详情页用,badge 不可改、不显示重试 */
  readOnly?: boolean;
  exportInfo?: ReviewExportInfo | null;
  /**
   * 报告布局。
   * - "stacked"（默认，答题页）：速览 + 详细信息依次铺开。
   * - "toggle"（历史页）：关键信息行常驻，速览(精简版)/详细(完整版)由分段控件切换。
   */
  reportLayout?: "stacked" | "toggle";
}

export function ReviewPanel({
  phase,
  reviewingElapsedSec,
  progressEvents = [],
  progressUnavailable = false,
  submission,
  errorMessage,
  errorView,
  userRating,
  autoRating,
  effectiveRating,
  ratingPending,
  onPickRating,
  onRetryReview,
  retryPending,
  canContinue = false,
  onContinue,
  onRestart,
  replayHref,
  reviewPlanHref,
  nextProblemHref,
  readOnly = false,
  exportInfo = null,
  reportLayout = "stacked",
}: Props) {
  // 历史页「精简/完整」切换态 + 常驻头部的导出对话框（hooks 须在任何早退之前声明）。
  const [reportView, setReportView] = useState<"concise" | "full">("concise");
  const [exportPanel, setExportPanel] = useState<ReviewExportPanel | null>(null);

  if (phase === "idle") {
    return (
      <p className={styles.idle}>
        写完代码后点"提交"，正常评测完成后这里会显示训练处方、评级、诊断、排程和五维摘要。
      </p>
    );
  }

  if (phase === "submitting" || phase === "reviewing") {
    if (phase === "reviewing" && !progressUnavailable) {
      return (
        <ReviewProgressTimeline
          events={progressEvents}
          elapsedSec={reviewingElapsedSec}
        />
      );
    }
    // SSE 进度流不可用（reviewing 且 progressUnavailable）：退化为通用骨架屏时，
    // 骨架上方保留一行说明，交代进度看不到但评测仍在后台进行。
    return (
      <>
        {phase === "reviewing" && progressUnavailable && (
          <p className={styles.progressFallbackNote}>
            进度流连接中断，评测仍在后台进行，完成后会自动刷新出结果。
          </p>
        )}
        <ReviewSkeleton phase={phase} elapsedSec={reviewingElapsedSec} />
      </>
    );
  }

  if (phase === "error") {
    const notice =
      errorView ??
      reviewErrorToAppError(
        submission?.review?.error_code ?? submission?.review_last_error_code,
        errorMessage ?? submission?.review?.error,
      );
    const actions = readOnly
      ? []
      : buildReviewActions({
          phase,
          submission,
          effectiveRating,
          canContinue,
          replayHref,
          reviewPlanHref,
          nextProblemHref,
          canExport: !!exportInfo,
        });
    const prescription = buildReviewPrescription({ phase, submission, effectiveRating });
    return (
      <div className={styles.wrap}>
        <StateBlock
          label="评测状态"
          title={notice.title}
          body={notice.message}
          tone="danger"
        />
        <ErrorNotice error={notice} />
        <ReviewActionFooter
          actions={actions}
          prescription={prescription}
          retryPending={retryPending}
          onRetryReview={onRetryReview}
        />
      </div>
    );
  }

  if (!submission || !submission.review) {
    return <p className={styles.idle}>提交已完成，但暂无评测内容。</p>;
  }

  const review = submission.review;
  const actions = readOnly
    ? [buildReviewExportAction(review)].filter(
        (action): action is ReviewAction => !!action && !!exportInfo,
      )
    : buildReviewActions({
        phase,
        submission,
        effectiveRating,
        canContinue,
        replayHref,
        reviewPlanHref,
        nextProblemHref,
        canExport: !!exportInfo,
      });
  const prescription = buildReviewPrescription({ phase, submission, effectiveRating });
  const dimensions = buildReviewDimensions({
    submission,
    review,
    effectiveRating,
    prescription,
  });
  const diagnosis = getReviewDiagnosis(review);

  if (reportLayout === "toggle") {
    return (
      <div className={styles.wrap}>
        <div className={styles.reportBar}>
          <div className={styles.reportKey}>
            <RatingBadge
              effective={effectiveRating}
              userRating={userRating}
              autoRating={autoRating}
              onPick={onPickRating}
              loading={ratingPending}
              readOnly={readOnly}
            />
            <div className={styles.reportStats}>
              <span>已用 {formatMMSS(submission.elapsed_sec)}</span>
              <span>{submission.snapshots_count} 个思考节点</span>
            </div>
          </div>
          <div className={styles.reportControls}>
            <div className={styles.segmented}>
              <button
                type="button"
                className={reportView === "concise" ? styles.segOn : styles.seg}
                onClick={() => setReportView("concise")}
              >
                精简版
              </button>
              <button
                type="button"
                className={reportView === "full" ? styles.segOn : styles.seg}
                data-qa="report-view-full"
                onClick={() => setReportView("full")}
              >
                完整版
              </button>
            </div>
            {exportInfo && (
              <Button
                variant="secondary"
                size="md"
                data-qa="history-export"
                onClick={() => setExportPanel("markdown")}
              >
                导出
              </Button>
            )}
          </div>
        </div>

        {reportView === "concise" ? (
          <ReviewOverview
            submission={submission}
            review={review}
            dimensions={dimensions}
            prescription={prescription}
            actions={actions}
            diagnosis={diagnosis}
            userRating={userRating}
            autoRating={autoRating}
            effectiveRating={effectiveRating}
            exportInfo={exportInfo}
            ratingPending={ratingPending}
            retryPending={retryPending}
            readOnly={readOnly}
            showRatingRow={false}
            showFooter={false}
            onPickRating={onPickRating}
            onContinue={onContinue}
            onRestart={onRestart}
            onRetryReview={onRetryReview}
          />
        ) : (
          <ReviewDetails
            submission={submission}
            review={review}
            dimensions={dimensions}
            diagnosis={diagnosis}
          />
        )}

        {exportInfo && (
          <ReviewExportDialog
            open={exportPanel !== null}
            initialPanel={exportPanel ?? "markdown"}
            input={{
              exportInfo,
              submission,
              review,
              dimensions,
              diagnosis,
              effectiveRating,
            }}
            onClose={() => setExportPanel(null)}
          />
        )}
      </div>
    );
  }

  return (
    <div className={styles.wrap}>
      <ReviewOverview
        submission={submission}
        review={review}
        dimensions={dimensions}
        prescription={prescription}
        actions={actions}
        diagnosis={diagnosis}
        userRating={userRating}
        autoRating={autoRating}
        effectiveRating={effectiveRating}
        exportInfo={exportInfo}
        ratingPending={ratingPending}
        retryPending={retryPending}
        readOnly={readOnly}
        onPickRating={onPickRating}
        onContinue={onContinue}
        onRestart={onRestart}
        onRetryReview={onRetryReview}
      />
      <ReviewDetails
        submission={submission}
        review={review}
        dimensions={dimensions}
        diagnosis={diagnosis}
      />
    </div>
  );
}

function formatMMSS(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const mm = String(Math.floor(s / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}

function StateBlock({
  label,
  title,
  body,
  tone,
}: {
  label: string;
  title: string;
  body: string;
  tone: "danger" | "neutral";
}) {
  return (
    <div className={`${styles.stateBlock} tone-${tone}`}>
      <div className={styles.stateLabel}>{label}</div>
      <p className={styles.stateTitle}>{title}</p>
      <p className={styles.stateBody}>{body}</p>
    </div>
  );
}
