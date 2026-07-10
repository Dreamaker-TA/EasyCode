import { useState } from "react";

import type { Rating, ReviewOutput, SubmissionDetail } from "@/api/types";
import { formatLocalMonthDayTime } from "@/lib/datetime";
import type { ReviewAction, ReviewPrescription } from "@/lib/reviewActions";
import type { ReviewDimension } from "@/lib/reviewDimensions";
import type { ReviewExportInfo } from "@/lib/reviewExportMarkdown";

import { RatingBadge } from "./RatingBadge";
import { ReviewActionFooter } from "./ReviewActionFooter";
import { ReviewExportDialog, type ReviewExportPanel } from "./ReviewExportDialog";
import { ReviewRadar } from "./ReviewRadar";
import styles from "./ReviewOverview.module.css";

interface Props {
  submission: SubmissionDetail;
  review: ReviewOutput;
  dimensions: ReviewDimension[];
  prescription: ReviewPrescription | null;
  actions: ReviewAction[];
  diagnosis: string;
  userRating: Rating | null;
  autoRating: Rating | null;
  effectiveRating: Rating | null;
  exportInfo?: ReviewExportInfo | null;
  ratingPending: boolean;
  retryPending?: boolean;
  readOnly?: boolean;
  /** 历史页「精简/完整切换」布局用：评级行与底部动作栏由外层常驻头部接管，这里隐藏以免重复。 */
  showRatingRow?: boolean;
  showFooter?: boolean;
  onPickRating: (next: Rating | null) => void;
  onContinue?: () => void;
  onRestart?: () => void;
  onRetryReview?: () => void;
}

export function ReviewOverview({
  submission,
  review,
  dimensions,
  prescription,
  actions,
  diagnosis,
  userRating,
  autoRating,
  effectiveRating,
  exportInfo = null,
  ratingPending,
  retryPending = false,
  readOnly = false,
  showRatingRow = true,
  showFooter = true,
  onPickRating,
  onContinue,
  onRestart,
  onRetryReview,
}: Props) {
  const [exportPanel, setExportPanel] = useState<ReviewExportPanel | null>(null);

  return (
    <section className={styles.wrap} data-qa="review-quick-summary">
      {prescription && <PrescriptionCard prescription={prescription} />}
      <div className={styles.topGrid}>
        <div className={styles.resultStack}>
          {showRatingRow && (
            <div className={styles.ratingRow}>
              <RatingBadge
                effective={effectiveRating}
                userRating={userRating}
                autoRating={autoRating}
                onPick={onPickRating}
                loading={ratingPending}
                readOnly={readOnly}
              />
              <div className={styles.ratingMeta}>
                <div className="kicker">评测结果</div>
                <div className={styles.stats}>
                  <span>已用 {formatMMSS(submission.elapsed_sec)}</span>
                  <span>{submission.snapshots_count} 个思考节点</span>
                </div>
              </div>
            </div>
          )}
          <div className={styles.diagnosis}>
            <div className="kicker">主诊断</div>
            <p>{diagnosis}</p>
          </div>
          <ScheduleSummary submission={submission} review={review} />
        </div>
        <div className={styles.radarPanel}>
          <ReviewRadar dimensions={dimensions} />
        </div>
      </div>
      <DimensionSummary dimensions={dimensions} />
      {showFooter && (
        <ReviewActionFooter
          actions={actions}
          retryPending={retryPending}
          onContinue={onContinue}
          onRestart={onRestart}
          onRetryReview={onRetryReview}
          onExportReview={exportInfo ? setExportPanel : undefined}
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
    </section>
  );
}

function PrescriptionCard({ prescription }: { prescription: ReviewPrescription }) {
  return (
    <div className={`${styles.prescription} tone-${prescription.tone}`}>
      <div>
        <div className="kicker">训练处方</div>
        <p className={styles.prescriptionTitle}>{prescription.title}</p>
        <p className={styles.prescriptionDetail}>{prescription.detail}</p>
      </div>
      {prescription.meta && <span className={styles.prescriptionMeta}>{prescription.meta}</span>}
    </div>
  );
}

function ScheduleSummary({ submission, review }: { submission: SubmissionDetail; review: ReviewOutput }) {
  const schedule = submission.review_schedule;
  let title = "排程未改变";
  let detail = "本次没有写入新的复习安排。";
  if (schedule) {
    title = `下次训练 ${formatScheduleDate(schedule.next_review_at)}`;
    detail = `评级 ${schedule.generated_from_rating} 生成 ${schedule.interval_days} 天间隔。`;
  } else if (submission.status === "review_failed" || review.error) {
    detail = "评测失败不会改动复习计划，服务恢复后可以重试。";
  }

  return (
    <div className={styles.schedule}>
      <div className="kicker">下次训练安排</div>
      <p className={styles.scheduleTitle}>{title}</p>
      <p className={styles.scheduleDetail}>{detail}</p>
    </div>
  );
}

function DimensionSummary({ dimensions }: { dimensions: ReviewDimension[] }) {
  return (
    <div className={styles.dimensionGrid} data-qa="review-dimension-summary">
      {dimensions.map((dimension) => (
        <div key={dimension.key} className={styles.dimensionItem}>
          <div className={styles.dimensionHead}>
            <span className={`${styles.toneDot} tone-${dimension.tone}`} />
            <span>{dimension.label}</span>
            <span className={styles.dimensionValue}>
              {dimension.value === null ? "—" : dimension.value}
            </span>
          </div>
          <p>{dimension.summary}</p>
        </div>
      ))}
    </div>
  );
}

function formatMMSS(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const mm = String(Math.floor(s / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}

function formatScheduleDate(value: string): string {
  return formatLocalMonthDayTime(value, value);
}
